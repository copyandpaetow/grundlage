import { ValueOf } from "../parser/types";
import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { paint, Painter, serverPaint, teardownPainter } from "./painter";
import { HTMLTemplate } from "./template-html";
import {
	COMMAND,
	EVENT,
	event,
	ROLE,
	step,
	StepEvent,
	Task,
	TASK_STATE,
} from "./task";

//the engine: the per-component runtime. it holds the DOM (painter) and the two coroutines (tasks),
//executes the reducer's commands, and owns the restart recipe + the coalescing flush. the reducer (step)
//is pure and lives in task.ts; nothing stateful or async happens there. persistent across reconnect — the
//painter keeps its renderedTemplate for DOM continuity, so a generation is reset in place (the slots are
//renulled) rather than rebuilt. the element owns one behind a #field.
export interface Engine {
	readonly host: BaseComponent;
	readonly componentGenerator: ComponentGenerator; //the root generator factory (mount)
	painter: Painter;
	//liveness IS slot occupancy: a task is current iff it still sits in its role's slot. a rerun swaps the
	//inner slot (superseding any in-flight inner) and never touches the outer; teardown/terminal null both.
	outer: Task | null;
	inner: Task | null;
	renderer: ComponentGenerator | RenderFunction | null; //the restart recipe (C1) — the engine owns it
	//the coalescing window: the first update() opens it (makes pendingFlush, schedules one microtask) and a
	//synchronous burst rides it; an update mid-render opens a fresh window whose rerun supersedes the
	//in-flight one via the slot swap. pendingFlush is the shared promise callers receive; settleFlush
	//resolves it when a live render lands (ADR-0003).
	scheduled: boolean;
	pendingFlush: PromiseWithResolvers<void> | null;
}

export const createEngine = (
	host: BaseComponent,
	painter: Painter,
	componentGenerator: ComponentGenerator,
): Engine => ({
	host,
	componentGenerator,
	painter,
	outer: null,
	inner: null,
	renderer: null,
	scheduled: false,
	pendingFlush: null,
});

const MODE = { SEND: 0, THROW: 1 } as const;

const OUTCOME = { SUSPENDED: 0, DONE: 1, THREW_UP: 2, FAILED: 3 } as const;
type Outcome = ValueOf<typeof OUTCOME>;

const createTask = (
	role: ValueOf<typeof ROLE>,
	generator: Generator | AsyncGenerator,
): Task => ({
	generator,
	role,
	state: TASK_STATE.DRIVING,
	cleanup: null,
});

//a task is live iff it still occupies its role's slot. a rerun swaps the inner slot; teardown/terminal
//null both. so a superseded task's pending .then finds itself no longer current and does nothing.
const isLive = (engine: Engine, task: Task): boolean =>
	(task.role === ROLE.INNER ? engine.inner : engine.outer) === task;

const spawnInner = (engine: Engine, source: ComponentGenerator): Task => {
	cancel(engine.inner);
	const inner = createTask(ROLE.INNER, source(engine.host));
	engine.inner = inner;
	return inner;
};

//cancel a coroutine: .return() runs its try/finally (D1), then any captured return-cleanup fires (D2).
//a sync generator's finally runs now; an async generator's .return() yields a Promise whose finally runs
//on a later microtask — fire-and-forget either way (the caller has already vacated this task's slot, so a
//late finally can't paint or settle), but surface a throwing async finally rather than leak a rejection.
const cancel = (task: Task | null): void => {
	if (task === null) return;
	let ending: unknown;
	try {
		ending = task.generator.return?.(undefined);
	} catch {
		//a sync finally threw mid-teardown; the element is going away — swallow so the rest still runs
	}
	if (ending instanceof Promise) ending.catch(console.warn);
	const cleanup = task.cleanup;
	if (cleanup !== null) {
		task.cleanup = null;
		cleanup();
	}
};

//the one mechanical bridge between a platform generator and the reducer: step it, and turn the outcome
//into a StepEvent — unless the step itself returned a Promise (an async-generator step), in which case
//hand that Promise straight back for the driver to await. NO decisions live here.
const classify = (result: IteratorResult<unknown>): StepEvent =>
	result.done
		? event(EVENT.RETURNED, result.value)
		: event(EVENT.YIELDED, result.value);

const pull = (
	task: Task,
	mode: ValueOf<typeof MODE>,
	value: unknown,
): StepEvent | Promise<IteratorResult<unknown>> => {
	let stepped: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		stepped =
			mode === MODE.THROW
				? (task.generator as Generator).throw!(value)
				: task.generator.next(value);
	} catch (error) {
		return event(EVENT.THREW, error);
	}
	return stepped instanceof Promise ? stepped : classify(stepped);
};

//the one fatal display (E3/F3), shared by the CSR and SSR terminals so neither re-implements it — and the
//single seam a component-level onError would hook into later. today: warn + write into the shadow.
const reportFatal = (host: BaseComponent, error: unknown): void => {
	console.warn(error);
	host.shadowRoot!.textContent = `${error}`;
};

//enter the terminal state (E3/F3): null the slots first (so any update() a finally triggers is a no-op),
//run both coroutines' finallys, show the error, and settle a flush awaiting this render.
const enterTerminal = (engine: Engine, error: unknown): void => {
	const { inner, outer } = engine;
	engine.inner = engine.outer = engine.renderer = null;
	cancel(inner);
	cancel(outer);
	reportFatal(engine.host, error);
	settleFlush(engine);
};

//resolve the shared update() promise once the whole flush window is done. idempotent: the first caller
//nulls the field, any later one is a no-op (a render that lands, then a disconnect, must not double-settle).
const settleFlush = (engine: Engine): void => {
	const flush = engine.pendingFlush;
	if (flush === null) return;
	engine.pendingFlush = null;
	flush.resolve();
};

//drive one task's commands until it suspends or terminates, returning an Outcome. SYNCHRONOUS (G1/G2):
//the only thing that escapes synchronously is awaiting a real promise, which attaches a .then and returns
//SUSPENDED — the continuation re-enters drive later, on its own stack. depth-2 is the inline drive in the
//INSTALL arm; the inner's error unwinds that recursion back into the outer.
const drive = (
	engine: Engine,
	task: Task,
	start: StepEvent | Promise<IteratorResult<unknown>> = pull(
		task,
		MODE.SEND,
		undefined,
	),
): Outcome => {
	let next = start;
	while (true) {
		if (next instanceof Promise) {
			//async-generator step: await it, then classify the settled iterator result
			next.then(
				(result) => {
					if (isLive(engine, task)) drive(engine, task, classify(result));
				},
				(error) => {
					if (isLive(engine, task))
						drive(engine, task, event(EVENT.THREW, error));
				},
			);
			return OUTCOME.SUSPENDED;
		}

		const command = step(task, next);
		switch (command.kind) {
			case COMMAND.PAINT:
				if (task.role === ROLE.OUTER) engine.renderer = null; //a static outer template ⇒ C6 no-op
				//user paint can throw; route it through the same error channel as a generator step
				try {
					paint(engine.painter, command.payload);
				} catch (error) {
					next = event(EVENT.THREW, error);
					break;
				}
				next = pull(task, MODE.SEND, engine.host);
				break;

			case COMMAND.PAINT_FROM:
				if (task.role === ROLE.OUTER) engine.renderer = command.payload; //re-callable on update() (C1)
				//the render function (user code) runs HERE, under the same error routing as a generator step
				try {
					paint(engine.painter, command.payload(engine.host));
				} catch (error) {
					next = event(EVENT.THREW, error);
					break;
				}
				next = pull(task, MODE.SEND, engine.host);
				break;

			case COMMAND.RESUME:
				next = pull(task, MODE.SEND, command.payload);
				break;

			case COMMAND.INSTALL: {
				engine.renderer = command.payload; //the re-runnable inner (C1)
				const innerOutcome = drive(engine, spawnInner(engine, command.payload));
				//the child's synchronous prefix is done. resume the outer ONLY if it did not throw up: a
				//THREW_UP already drove the outer (recovery / dismiss / terminal) — never drive it twice.
				if (innerOutcome === OUTCOME.THREW_UP) return OUTCOME.THREW_UP;
				next = pull(task, MODE.SEND, engine.host); //resume outer → it reaches `return cleanup` (D2)
				break;
			}

			case COMMAND.AWAIT: {
				const promise = command.payload; //capture BEFORE the cell is reused
				promise.then(
					(value) => {
						if (isLive(engine, task))
							drive(engine, task, event(EVENT.RESUMED, value));
					},
					(error) => {
						if (isLive(engine, task))
							drive(engine, task, event(EVENT.THREW, error));
					},
				);
				return OUTCOME.SUSPENDED;
			}

			case COMMAND.THROW_TO_PARENT: {
				const error = command.payload; //capture BEFORE the cell is reused
				cancel(engine.inner); //stop the failed child, run its finally (D1)
				const parent = engine.outer;
				const parentCanCatch =
					parent !== null && parent.state === TASK_STATE.DRIVING;
				if (!parentCanCatch) {
					enterTerminal(engine, error); //no live parent to catch → E3
					return OUTCOME.THREW_UP;
				}
				const reaction = pull(parent, MODE.THROW, error); //deliver into the outer's try/catch
				//the outer caught and RETURNED a cleanup straight away (no new content): it has given up.
				//run that cleanup now and drop it — the prior view persists (E2 / catch-return contract).
				const dismissed =
					!(reaction instanceof Promise) && reaction.kind === EVENT.RETURNED;
				if (dismissed) {
					parent.cleanup =
						typeof reaction.payload === "function"
							? (reaction.payload as VoidFunction)
							: null;
					cancel(parent);
					engine.outer = null;
				} else {
					drive(engine, parent, reaction); //recover by yielding new content, or terminal
				}
				return OUTCOME.THREW_UP;
			}

			case COMMAND.COMPLETED:
				if (task.role === ROLE.INNER) settleFlush(engine); //the renderer landed → resolve update() (C2)
				return OUTCOME.DONE; //an outer return never settles an update — its cleanup waits for disconnect

			case COMMAND.FAIL:
				enterTerminal(engine, command.payload); //E3
				return OUTCOME.FAILED;

			case COMMAND.NOOP:
				return OUTCOME.SUSPENDED; //no transition for this (state, event): nothing to do
		}
	}
};

//mount: spawn the root generator into the outer slot and drive it to first paint (synchronous — a fully
//sync component pays no async cost at all).
export const startEngine = (engine: Engine): void => {
	engine.outer = createTask(ROLE.OUTER, engine.componentGenerator(engine.host));
	drive(engine, engine.outer);
};

//disconnect (D4): null the slots first (so a cleanup that calls update() is a no-op), then cancel both
//tasks (their finallys run, captured cleanups fire), disconnect the observer, and settle any awaiting
//update() so it never hangs (C2 on teardown). the persistent engine is left ready to restart.
export const teardownEngine = (engine: Engine): void => {
	const { inner, outer } = engine;
	engine.inner = engine.outer = engine.renderer = null;
	cancel(inner);
	cancel(outer);
	teardownPainter(engine.painter);
	settleFlush(engine);
};

//re-run the CURRENT renderer (C1). a generator current restarts as a fresh inner, whose slot swap
//supersedes any in-flight inner; a render-function current is re-called + painted synchronously. the
//outer slot is never touched. settleFlush fires when the render lands — synchronously here, or on the
//inner's COMPLETED for a generator that suspends.
const rerun = (engine: Engine): void => {
	const renderer = engine.renderer;
	if (renderer === null) return; //terminal / teardown already cleared and settled it mid-flush (C6)
	if (!isGeneratorFunction(renderer)) {
		try {
			paint(engine.painter, (renderer as RenderFunction)(engine.host));
			settleFlush(engine); //a render-function current lands synchronously
		} catch (error) {
			enterTerminal(engine, error);
		}
		return;
	}
	drive(engine, spawnInner(engine, renderer as ComponentGenerator));
};

//the coalescing window (ADR-0003). the first update() makes the shared pendingFlush and schedules one
//microtask; a synchronous burst rides it. flush closes the window and re-runs the current renderer — an
//update arriving while that render is still in flight opens a fresh window, whose rerun supersedes the
//in-flight one via the slot swap. settleFlush resolves pendingFlush when a live render lands.
const flush = (engine: Engine): void => {
	engine.scheduled = false;
	rerun(engine);
};

export const enqueueUpdate = (engine: Engine): Promise<void> => {
	engine.pendingFlush ??= Promise.withResolvers<void>();
	if (!engine.scheduled) {
		engine.scheduled = true;
		queueMicrotask(() => flush(engine));
	}
	return engine.pendingFlush.promise;
};

//update() is a no-op resolve when there is no re-runnable current (C6): a static template, a server render
//that left the renderer null, or a disconnected element whose generation was torn down.
export const hasRerunnableCurrent = (engine: Engine): boolean =>
	engine.renderer !== null;

//SSR (F1–F3): a second driver that shares the pure reducer but forks the effect interpreter. the
//generation runs once, server-paints the first paint, and stops — no observer, no flush, no
//resume-to-capture-cleanup. recovery still works (a recoverable inner error lets the outer yield a
//fallback, so the server emits the SAME content the client would — no hydration mismatch).
export const driveServerOnce = (engine: Engine): void => {
	engine.outer = createTask(ROLE.OUTER, engine.componentGenerator(engine.host));
	serverDrive(engine, engine.outer);
};

const serverDrive = (
	engine: Engine,
	task: Task,
	start: StepEvent | Promise<IteratorResult<unknown>> = pull(
		task,
		MODE.SEND,
		undefined,
	),
): void => {
	let next = start;
	while (true) {
		if (next instanceof Promise) {
			//the server is allowed to await (data load) before the first yield
			next.then(
				(result) => serverDrive(engine, task, classify(result)),
				(error) => enterTerminal(engine, error),
			);
			return;
		}

		const command = step(task, next);
		switch (command.kind) {
			case COMMAND.PAINT:
			case COMMAND.PAINT_FROM: {
				let template: HTMLTemplate;
				try {
					template =
						command.kind === COMMAND.PAINT
							? command.payload
							: (command.payload as RenderFunction)(engine.host);
				} catch (error) {
					next = event(EVENT.THREW, error); //route a throwing render fn through recovery / terminal
					break;
				}
				serverPaint(engine.painter, template); //F1: the first paint is server-painted…
				return finishServer(engine); //…and ends the generation (F2)
			}

			case COMMAND.INSTALL:
				return serverDrive(engine, spawnInner(engine, command.payload)); //the inner's first paint IS the paint

			case COMMAND.RESUME:
				next = pull(task, MODE.SEND, command.payload);
				break;

			case COMMAND.AWAIT:
				command.payload.then(
					(value) => serverDrive(engine, task, event(EVENT.RESUMED, value)),
					(error) => enterTerminal(engine, error),
				);
				return;

			case COMMAND.THROW_TO_PARENT: {
				const error = command.payload; //capture BEFORE the cell is reused
				cancel(engine.inner);
				const parent = engine.outer;
				if (parent !== null && parent.state === TASK_STATE.DRIVING)
					return serverDrive(engine, parent, pull(parent, MODE.THROW, error));
				return enterTerminal(engine, error); //F3: nothing to catch
			}

			case COMMAND.COMPLETED:
				return finishServer(engine); //F2: returned with nothing renderable

			case COMMAND.FAIL:
				return enterTerminal(engine, command.payload); //F3: pre-paint throw

			case COMMAND.NOOP:
				return; //no supersession on a one-shot server run
		}
	}
};

//the server's terminal: abandon both coroutines (running their finallys, D1/F2) and clear the renderer so
//any later update() is a no-op.
const finishServer = (engine: Engine): void => {
	cancel(engine.inner);
	cancel(engine.outer);
	engine.inner = engine.outer = engine.renderer = null;
};
