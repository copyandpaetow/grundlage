import { ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { paint, Painter, serverPaint } from "./painter";
import { cancelTask, createTask, driveTask, Task, throwIntoTask } from "./task";
import { HTMLTemplate, isTemplate } from "./template-html";

/*
the Producer capability is the depth-0/1 generator lifetime (the recursive Task collapse: root =
depth 0, current = depth 1 of the same Task), plus the restart recipe update() re-runs, plus its
OWN settle signal. it holds exactly one downward edge — the Painter — and NO edge back up to the
scheduler. its settle is reported by RETURNING a Promise from pullProducer, so the dependency stays
a straight line (Scheduler → Producer → Painter) instead of a cycle.

ONE Producer serves both client and server. The server is the client minus the Scheduler: the
scheduler half is simply never driven (settleResolve stays null ⇒ resolveSettle is a no-op;
createCurrent is a dead write; pullProducer is never called), so it needs no flag. The single thing
that genuinely differs at runtime — what a renderable yield COMMITS — is carried as data: the
`commit` strategy function. clientCommit patches/replaces continuously; serverCommit paints ONCE
then cancels both task layers. The yield handler just calls `producer.commit(...)` — no mode branch.
This is the same behavior-as-data shape Task uses for onYield/onError/onSettle.

R = Producer for every Task here, so the Task driver's hot call sites stay monomorphic. A component
only ever uses one commit strategy, so `producer.commit(...)` is monomorphic per instance too.
*/

export interface Producer {
	rootTask: Task<Producer> | null; //depth 0; installs producers, never restarts on update()
	currentTask: Task<Producer> | null; //depth 1; non-null ⇔ the current producer is a generator
	//the recipe update() re-runs. null ⇔ static current (a no-op update). NOT nulled on natural root
	//completion — rootTask keeps pointing at the finished root. on the server it is a dead write (set
	//when a generator installs, read only by the teardown guard and pullProducer, never called on the server)
	createCurrent: ComponentGenerator | RenderFunction | null;
	//the resolver for the single in-flight render. null ⇔ no flush awaiting. stays null for a server
	//Producer (no scheduler sets it ⇒ resolveSettle no-ops there)
	settleResolve: VoidFunction | null;
	//the client/server difference as data: clientCommit (continuous patch/replace) or serverCommit
	//(one-shot paint + cancel). same field, same role in both
	commit: (producer: Producer, value: HTMLTemplate) => void;
	painter: Painter; //the only edge — downward, to the leaf
}

//client: continuous commit — patch-or-replace + the host-attribute observer bracket. never latches
export const clientCommit = (producer: Producer, value: HTMLTemplate): void =>
	paint(producer.painter, value);

//server: one-shot commit — the first renderable produces/hydrates + drains the load() buffer, then
//cancels both task layers (their finally runs, any returned cleanup is discarded). cancelling both is
//what makes it one-shot: no later yield can reach a cancelled task, so no latch is needed
export const serverCommit = (producer: Producer, value: HTMLTemplate): void => {
	serverPaint(producer.painter, value);
	if (producer.currentTask !== null) cancelTask(producer.currentTask);
	if (producer.rootTask !== null) cancelTask(producer.rootTask);
};

//the one factory; the caller passes clientCommit or serverCommit. the chosen strategy is the whole
//client/server difference — everything else is identical
export const createProducer = (
	painter: Painter,
	commit: (producer: Producer, value: HTMLTemplate) => void,
): Producer => ({
	rootTask: null,
	currentTask: null,
	createCurrent: null,
	settleResolve: null,
	commit,
	painter,
});

export const startRoot = (
	producer: Producer,
	createGenerator: ComponentGenerator,
): void => {
	producer.rootTask = createTask(
		producer,
		createGenerator(producer.painter.host),
		null, //parent null ⇒ root
		producerYield,
		//onError inlined (a closure per task capturing `producer`) rather than a shared adapter: the error
		//path is cold, so the allocation buys directness over another named hop
		(_task, error) => reportProducerError(producer, error),
		null, //the root never resolves a flush
	);
	driveTask(producer.rootTask);
};

//release: cancel both layers (finally + cleanup run via cancelTask) and forget the recipe. the
//caller resolves any pending settle separately (disconnect / abort) so an `await update()` can't hang
export const teardownProducer = (producer: Producer): void => {
	if (producer.currentTask !== null) cancelTask(producer.currentTask);
	if (producer.rootTask !== null) cancelTask(producer.rootTask);
	producer.currentTask = null;
	producer.rootTask = null;
	producer.createCurrent = null;
};

//resolve the in-flight render's flush exactly once. idempotent: nulls the resolver first so a
//re-entrant terminal path can call it twice safely
export const resolveSettle = (producer: Producer): void => {
	const resolve = producer.settleResolve;
	if (resolve === null) return; //settle outside a flush window (e.g. the initial connect) is ignored
	producer.settleResolve = null;
	resolve();
};

//one yield handler for both depths and both modes. isRoot gates the depth-specific acts (swap the
//previous child, record the restart recipe, allow installing a nested generator). the only
//mode-specific spot is producer.commit(...) — a call, not a branch
const producerYield = (task: Task<Producer>, value: unknown): unknown => {
	const producer = task.runtime;
	const host = producer.painter.host;
	const isRoot = task.parent === null;

	if (isTemplate(value)) {
		if (isRoot) {
			swapChild(producer);
			producer.createCurrent = null; //static: update() is a no-op
		}
		producer.commit(producer, value);
		return host;
	}

	if (typeof value === "function") {
		if (isGeneratorFunction(value)) {
			if (!isRoot) //only the root may install a nested generator
				throw new Error("Inner generators cannot yield generator functions");
			swapChild(producer);
			producer.createCurrent = value as ComponentGenerator;
			spawnChild(producer, task, value as ComponentGenerator);
			return host;
		}
		if (isRoot) {
			swapChild(producer);
			producer.createCurrent = value as RenderFunction; //re-callable on update()
		}
		producer.commit(producer, (value as RenderFunction)(host));
		return host;
	}

	return value; //plain value (e.g. a resolved Promise) flows back as the yield result
};

//spawn the depth-1 child. parent is the root, so the child's errors bubble there
const spawnChild = (
	producer: Producer,
	parent: Task<Producer>,
	createGenerator: ComponentGenerator,
): void => {
	producer.currentTask = createTask(
		producer,
		createGenerator(producer.painter.host),
		parent,
		producerYield,
		(_task, error) => reportProducerError(producer, error), //inlined onError (see startRoot)
		//onSettle inlined (single-use, capturing `producer`): the child settled (done or uncaught) — resolve
		//the in-flight render unless a newer child has already superseded it
		(settled) => {
			if (producer.currentTask === settled) resolveSettle(producer);
		},
	);
	driveTask(producer.currentTask);
};

const swapChild = (producer: Producer): void => {
	if (producer.currentTask !== null) {
		cancelTask(producer.currentTask);
		producer.currentTask = null;
	}
};

/*
bubble a current error to the root for try/catch recovery, or abort at the top. runtime-first (reads
producer.rootTask) so a synchronous render-fn throw — which has no live task — routes here too.

the early all-null return guards the re-entrant terminal path: inner error → throwIntoTask(root) →
root rethrows → root.onError → here AGAIN. without it, a re-entry after teardown would hit
`root === null` → abort → warn a second time. the guard makes any post-teardown entry a clean no-op.
*/
export const reportProducerError = (producer: Producer, error: Error): void => {
	if (
		producer.rootTask === null &&
		producer.currentTask === null &&
		producer.createCurrent === null
	) {
		resolveSettle(producer); //already torn down; never warn twice, just unstick any awaiting flush
		return;
	}

	const root = producer.rootTask;
	if (root === null || root.finished) {
		abort(producer, error); //root error, or a child whose root is already gone; resolves settle itself
		return;
	}

	const previousChild = producer.currentTask;
	throwIntoTask(root, error); //resume the root inside its try; it may recover by yielding
	if (root.finished) {
		//root caught + returned / fell through. drop the dead layers; rendered DOM stays put
		cancelTask(root);
		if (producer.rootTask === root) producer.rootTask = null;
		if (producer.currentTask === previousChild) {
			swapChild(producer);
			producer.createCurrent = null;
		}
	}
	//if recovery left no live current generator, this call's DOM has landed — settle the flush. (a new
	//generator current settles on its own via its onSettle, so don't double-resolve here)
	if (producer.currentTask === null) resolveSettle(producer);
};

const abort = (producer: Producer, error: Error): void => {
	const host = producer.painter.host;
	teardownProducer(producer);
	resolveSettle(producer); //don't leave an `await update()` hanging
	console.warn(error);
	host.shadowRoot!.textContent = `${error}`;
};

//re-run the current producer and RETURN a Promise that resolves once this dispatch settles. that
//returned promise IS the upward signal — Producer never references the scheduler
export const pullProducer = (producer: Producer): Promise<void> =>
	new Promise<void>((resolve) => {
		producer.settleResolve = resolve;
		const recipe = producer.createCurrent;
		if (recipe === null) {
			resolveSettle(producer); //static current: no-op resolve
			return;
		}
		if (producer.currentTask !== null) {
			cancelTask(producer.currentTask); //supersede the in-flight render
			spawnChild(producer, producer.rootTask!, recipe as ComponentGenerator);
			//async: the child resolves via its onSettle when it lands
		} else {
			paint(producer.painter, (recipe as RenderFunction)(producer.painter.host));
			resolveSettle(producer); //render-fn settles synchronously
		}
	});
