/*
the generator-lifetime primitive: one depth-aware Task drives one generator at one depth.

a component's render tree is at most two levels deep: a ROOT generator that installs producer, and at
most one CURRENT generator it installs. those become depth 0 / depth 1 of the same Task, driven by the
same loop. depth is a single `parent === null` check: the root's parent is null, a current's is the root.

Task is generic over the runtime R and touches NO DOM — pure generator plumbing. the runtime-specific
behaviour (what a yield installs, how an error recovers, when a flush settles) lives in the three hooks
the runtime supplies at createTask. the hot hook (onYield) is a shared singleton, so the driver's
`task.onYield(task, value)` call stays monomorphic; the cold hooks (onError / onSettle) may be small
per-task closures.
*/

//a driven generator at one depth. `parent` is both the depth marker and the error-bubble target
export interface Task<R> {
	generator: Generator | AsyncGenerator;
	//set on natural completion, external cancel, or uncaught throw. pending awaits check it before resuming
	finished: boolean;
	//captured from the generator's `return cleanupFn`; fired by the cancelTask that follows
	cleanup: VoidFunction | null;
	//typed runtime ref — the hooks read it without the `context as Runtime` cast the old handle needed
	runtime: R;
	//null ⇔ root (depth 0). a current's parent is the root, which stays non-null until teardown, so
	//`parent === null` reliably tells root from current
	parent: Task<R> | null;
	onYield: (task: Task<R>, value: unknown) => unknown;
	onError: (task: Task<R>, error: Error) => void;
	//null when nothing waits on this task's terminal (the root, and every SSR task). set on a CSR
	//current so the scheduler can resolve update()'s flush when the render finally settles
	onSettle: ((task: Task<R>) => void) | null;
}

export const createTask = <R>(
	runtime: R,
	generator: Generator | AsyncGenerator,
	parent: Task<R> | null,
	onYield: (task: Task<R>, value: unknown) => unknown,
	onError: (task: Task<R>, error: Error) => void,
	onSettle: ((task: Task<R>) => void) | null,
): Task<R> => ({ generator, finished: false, cleanup: null, runtime, parent, onYield, onError, onSettle });

//begin driving. the caller MUST have stored the task in its runtime slot first (rootTask /
//currentTask), so a synchronous yield/error/paint in this first step re-enters hook code that
//reads the right slot rather than a stale one (the create-before-drive ordering)
export const driveTask = <R>(task: Task<R>): void => step(task, task.generator.next(undefined));

//mark finished, run the generator's finally via .return(), then fire any captured cleanup.
//=> idempotent: the finished guard makes a second call a no-op for the generator side, and cleanup
//   is nulled after firing so it can't run twice. this idempotency is the safety net the re-entrant
//   error path leans on (see producer' reportProducerError)
//=> always fires cleanup even when already finished: a generator that completed naturally with
//   `return cleanupFn` stashed the fn in task.cleanup, and the cancel that follows (a swap or a
//   disconnect) is when we run it
//=> fires NO onSettle — cancellation is runtime-driven supersession, where the runtime already owns
//   flush resolution
export const cancelTask = <R>(task: Task<R>): void => {
	if (!task.finished) {
		task.finished = true;
		try {
			(task.generator as Generator).return?.(undefined);
		} catch {
			//user finally threw; swallow so the rest of teardown still runs
		}
	}
	const cleanup = task.cleanup;
	if (cleanup !== null) {
		task.cleanup = null;
		cleanup();
	}
};

//inject an error into a live task for try/catch recovery. if the generator catches and continues,
//step resumes from the throw's IteratorResult; if the throw escapes, the task finishes and onError
//fires so the parent (or the abort path) gets to handle it
export const throwIntoTask = <R>(task: Task<R>, error: Error): void => {
	if (task.finished) return;
	let next: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		next = (task.generator as Generator).throw!(error);
	} catch (uncaught) {
		settleError(task, uncaught as Error);
		return;
	}
	step(task, next);
};

//fire the settle notification exactly once. terminal points call this AFTER finishing (and after
//onError, so error recovery has already run by the time a waiter re-evaluates its flush). cancelTask
//deliberately doesn't route through here: supersession is runtime-driven and the runtime resolves
//the flush itself
const notifySettled = <R>(task: Task<R>): void => {
	const onSettle = task.onSettle;
	if (onSettle !== null) {
		task.onSettle = null;
		onSettle(task);
	}
};

//the one terminal-on-error path: finish, report, settle. shared by every place a throw escapes the
//generator (sync yield/next, async rejection, an uncaught throwIntoTask)
const settleError = <R>(task: Task<R>, error: Error): void => {
	if (task.finished) return;
	task.finished = true;
	task.onError(task, error);
	notifySettled(task);
};

//the driver. loops synchronously while it can, suspends only on a real Promise, and finishes on done /
//throw / external cancel. the `.then` closures allocate per await (unavoidable) and capture only
//`task`; they check task.finished before resuming so a cancelled task's pending awaits go nowhere
const step = <R>(
	task: Task<R>,
	next: IteratorResult<unknown> | Promise<IteratorResult<unknown>>,
): void => {
	while (true) {
		if (task.finished) return;

		//async generator: .next() returned a Promise of the next IteratorResult
		if (next instanceof Promise) {
			next.then(
				(resolved) => {
					if (!task.finished) step(task, resolved);
				},
				(error) => settleError(task, error as Error),
			);
			return;
		}

		if (next.done) {
			//user's `return cleanupFn`. stash so the following cancelTask can fire it
			if (typeof next.value === "function") task.cleanup = next.value as VoidFunction;
			task.finished = true;
			notifySettled(task);
			return;
		}

		//sync generator yielded a Promise: unwrap before handing the resolved value to onYield
		if (next.value instanceof Promise) {
			next.value.then(
				(resolved) => {
					if (!task.finished) step(task, { done: false, value: resolved });
				},
				(error) => settleError(task, error as Error),
			);
			return;
		}

		let result: unknown;
		try {
			result = task.onYield(task, next.value);
		} catch (error) {
			settleError(task, error as Error);
			return;
		}

		//onYield can run user code (a render, a nested install) that synchronously errors back through
		//this same task, marking it finished. re-check before stepping, else we'd call .next() on a
		//finished task and shadow the real error
		if (task.finished) return;

		try {
			next = task.generator.next(result);
		} catch (error) {
			settleError(task, error as Error);
			return;
		}
	}
};
