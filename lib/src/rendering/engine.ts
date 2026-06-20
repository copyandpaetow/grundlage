import { ValueOf } from "../parser/types";
import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { paint, Painter, serverPaint, teardownPainter } from "./painter";
import { HTMLTemplate } from "./template-html";
import { createStepOutcome, nextOperation, OPERATION, ROLE, STEP_OUTCOME, StepOutcome, Task, TASK_STATE } from "./task";

export interface Engine {
	readonly host: BaseComponent;
	readonly componentGenerator: ComponentGenerator;
	painter: Painter;
	outer: Task | null;
	inner: Task | null;
	renderer: ComponentGenerator | RenderFunction | null;
	scheduled: boolean;
	pendingUpdate: PromiseWithResolvers<void> | null;
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
	pendingUpdate: null,
});

const MODE = { SEND: 0, THROW: 1 } as const;

const OUTCOME = { SUSPENDED: 0, DONE: 1, THREW_UP: 2, FAILED: 3 } as const;
type Outcome = ValueOf<typeof OUTCOME>;

const createRenderTask = (
	role: ValueOf<typeof ROLE>,
	generator: Generator | AsyncGenerator,
): Task => ({
	generator,
	role,
	state: TASK_STATE.DRIVING,
	cleanup: null,
});

const isTaskLive = (engine: Engine, task: Task): boolean =>
	(task.role === ROLE.INNER ? engine.inner : engine.outer) === task;

const resetInnerTask = (engine: Engine, source: ComponentGenerator): Task => {
	cancelTaskAndRunCleanup(engine.inner);
	const inner = createRenderTask(ROLE.INNER, source(engine.host));
	engine.inner = inner;
	return inner;
};

const cancelTaskAndRunCleanup = (task: Task | null): void => {
	if (task === null) return;
	let ending: unknown;
	try {
		ending = task.generator.return?.(undefined);
	} catch {}
	if (ending instanceof Promise) ending.catch(console.warn);
	const cleanup = task.cleanup;
	if (cleanup !== null) {
		task.cleanup = null;
		cleanup();
	}
};

//a settled outcome, or a pending raw step the driver converts on settle. heterogeneous on purpose: the
//settled arm writes the shared outcome cell and is read immediately; the pending arm can't (the cell would
//be clobbered across the await), so it carries the raw result and the driver converts it synchronously.
type SteppedTask = StepOutcome | Promise<IteratorResult<unknown>>;

const createCleanStepOutcome = (
	result: IteratorResult<unknown>,
): StepOutcome =>
	result.done
		? createStepOutcome(STEP_OUTCOME.RETURNED, result.value)
		: createStepOutcome(STEP_OUTCOME.YIELDED, result.value);

const nextTaskStep = (
	task: Task,
	mode: ValueOf<typeof MODE>,
	value: unknown,
): SteppedTask => {
	let stepped: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		stepped =
			mode === MODE.THROW
				? (task.generator as Generator).throw!(value)
				: task.generator.next(value);
	} catch (error) {
		return createStepOutcome(STEP_OUTCOME.THREW, error);
	}
	return stepped instanceof Promise ? stepped : createCleanStepOutcome(stepped);
};

const writeFatalErrorIntoShadow = (
	host: BaseComponent,
	error: unknown,
): void => {
	console.warn(error);
	host.shadowRoot!.textContent = `${error}`;
};

const cancelEngineAndNotifyHost = (engine: Engine, error: unknown): void => {
	const { inner, outer } = engine;
	engine.inner = engine.outer = engine.renderer = null;
	cancelTaskAndRunCleanup(inner);
	cancelTaskAndRunCleanup(outer);
	writeFatalErrorIntoShadow(engine.host, error);
	resolvePendingUpdatePromise(engine);
};

const resolvePendingUpdatePromise = (engine: Engine): void => {
	const updatePromise = engine.pendingUpdate;
	if (updatePromise === null) return;
	engine.pendingUpdate = null;
	updatePromise.resolve();
};

const runTask = (
	engine: Engine,
	task: Task,
	start: SteppedTask = nextTaskStep(task, MODE.SEND, undefined),
): Outcome => {
	let next = start;
	while (true) {
		if (next instanceof Promise) {
			next.then(
				(result) => {
					if (isTaskLive(engine, task))
						runTask(engine, task, createCleanStepOutcome(result));
				},
				(error) => {
					if (isTaskLive(engine, task))
						runTask(engine, task, createStepOutcome(STEP_OUTCOME.THREW, error));
				},
			);
			return OUTCOME.SUSPENDED;
		}

		const operation = nextOperation(task, next);
		switch (operation.kind) {
			case OPERATION.PAINT:
				if (task.role === ROLE.OUTER) engine.renderer = null;
				try {
					paint(engine.painter, operation.payload);
				} catch (error) {
					next = createStepOutcome(STEP_OUTCOME.THREW, error);
					break;
				}
				next = nextTaskStep(task, MODE.SEND, engine.host);
				break;

			case OPERATION.PAINT_FROM:
				if (task.role === ROLE.OUTER) engine.renderer = operation.payload;
				try {
					paint(engine.painter, operation.payload(engine.host));
				} catch (error) {
					next = createStepOutcome(STEP_OUTCOME.THREW, error);
					break;
				}
				next = nextTaskStep(task, MODE.SEND, engine.host);
				break;

			case OPERATION.RESUME:
				next = nextTaskStep(task, MODE.SEND, operation.payload);
				break;

			case OPERATION.INSTALL: {
				engine.renderer = operation.payload;
				const innerOutcome = runTask(
					engine,
					resetInnerTask(engine, operation.payload),
				);
				if (innerOutcome === OUTCOME.THREW_UP) return OUTCOME.THREW_UP;
				next = nextTaskStep(task, MODE.SEND, engine.host);
				break;
			}

			case OPERATION.AWAIT: {
				const promise = operation.payload;
				promise.then(
					(value) => {
						if (isTaskLive(engine, task))
							runTask(
								engine,
								task,
								createStepOutcome(STEP_OUTCOME.RESUMED, value),
							);
					},
					(error) => {
						if (isTaskLive(engine, task))
							runTask(
								engine,
								task,
								createStepOutcome(STEP_OUTCOME.THREW, error),
							);
					},
				);
				return OUTCOME.SUSPENDED;
			}

			case OPERATION.THROW_TO_PARENT: {
				const error = operation.payload;
				cancelTaskAndRunCleanup(engine.inner);
				const parent = engine.outer;
				const parentCanCatch =
					parent !== null && parent.state === TASK_STATE.DRIVING;
				if (!parentCanCatch) {
					cancelEngineAndNotifyHost(engine, error);
					return OUTCOME.THREW_UP;
				}
				const reaction = nextTaskStep(parent, MODE.THROW, error);
				const dismissed =
					!(reaction instanceof Promise) &&
					reaction.kind === STEP_OUTCOME.RETURNED;
				if (dismissed) {
					parent.cleanup =
						typeof reaction.payload === "function"
							? (reaction.payload as VoidFunction)
							: null;
					cancelTaskAndRunCleanup(parent);
					engine.outer = null;
				} else {
					runTask(engine, parent, reaction);
				}
				return OUTCOME.THREW_UP;
			}

			case OPERATION.COMPLETED:
				if (task.role === ROLE.INNER) resolvePendingUpdatePromise(engine);
				return OUTCOME.DONE;

			case OPERATION.FAIL:
				cancelEngineAndNotifyHost(engine, operation.payload);
				return OUTCOME.FAILED;

			case OPERATION.NOOP:
				return OUTCOME.SUSPENDED;
		}
	}
};

export const startEngine = (engine: Engine): void => {
	engine.outer = createRenderTask(
		ROLE.OUTER,
		engine.componentGenerator(engine.host),
	);
	runTask(engine, engine.outer);
};

export const stopEngine = (engine: Engine): void => {
	const { inner, outer } = engine;
	engine.inner = engine.outer = engine.renderer = null;
	cancelTaskAndRunCleanup(inner);
	cancelTaskAndRunCleanup(outer);
	teardownPainter(engine.painter);
	resolvePendingUpdatePromise(engine);
};

const rerunCurrentRenderer = (engine: Engine): void => {
	const renderer = engine.renderer;
	if (renderer === null) return;
	if (!isGeneratorFunction(renderer)) {
		try {
			paint(engine.painter, (renderer as RenderFunction)(engine.host));
			resolvePendingUpdatePromise(engine);
		} catch (error) {
			cancelEngineAndNotifyHost(engine, error);
		}
		return;
	}
	runTask(engine, resetInnerTask(engine, renderer as ComponentGenerator));
};

const flushScheduledRerun = (engine: Engine): void => {
	engine.scheduled = false;
	rerunCurrentRenderer(engine);
};

export const scheduleNextUpdate = (engine: Engine): Promise<void> => {
	engine.pendingUpdate ??= Promise.withResolvers<void>();
	if (!engine.scheduled) {
		engine.scheduled = true;
		queueMicrotask(() => flushScheduledRerun(engine));
	}
	return engine.pendingUpdate.promise;
};

export const hasRenderer = (engine: Engine): boolean =>
	engine.renderer !== null;

export const startServerEngine = (engine: Engine): void => {
	engine.outer = createRenderTask(
		ROLE.OUTER,
		engine.componentGenerator(engine.host),
	);
	runServerTask(engine, engine.outer);
};

const runServerTask = (
	engine: Engine,
	task: Task,
	start: SteppedTask = nextTaskStep(task, MODE.SEND, undefined),
): void => {
	let next = start;
	while (true) {
		if (next instanceof Promise) {
			next.then(
				(result) => runServerTask(engine, task, createCleanStepOutcome(result)),
				(error) => cancelEngineAndNotifyHost(engine, error),
			);
			return;
		}

		const operation = nextOperation(task, next);
		switch (operation.kind) {
			case OPERATION.PAINT:
			case OPERATION.PAINT_FROM: {
				let template: HTMLTemplate;
				try {
					template =
						operation.kind === OPERATION.PAINT
							? operation.payload
							: (operation.payload as RenderFunction)(engine.host);
				} catch (error) {
					next = createStepOutcome(STEP_OUTCOME.THREW, error);
					break;
				}
				serverPaint(engine.painter, template);
				return finishServerRenderAndCancel(engine);
			}

			case OPERATION.INSTALL:
				return runServerTask(engine, resetInnerTask(engine, operation.payload));

			case OPERATION.RESUME:
				next = nextTaskStep(task, MODE.SEND, operation.payload);
				break;

			case OPERATION.AWAIT:
				operation.payload.then(
					(value) =>
						runServerTask(
							engine,
							task,
							createStepOutcome(STEP_OUTCOME.RESUMED, value),
						),
					(error) => cancelEngineAndNotifyHost(engine, error),
				);
				return;

			case OPERATION.THROW_TO_PARENT: {
				const error = operation.payload;
				cancelTaskAndRunCleanup(engine.inner);
				const parent = engine.outer;
				if (parent !== null && parent.state === TASK_STATE.DRIVING)
					return runServerTask(
						engine,
						parent,
						nextTaskStep(parent, MODE.THROW, error),
					);
				return cancelEngineAndNotifyHost(engine, error);
			}

			case OPERATION.COMPLETED:
				return finishServerRenderAndCancel(engine);

			case OPERATION.FAIL:
				return cancelEngineAndNotifyHost(engine, operation.payload);

			case OPERATION.NOOP:
				return;
		}
	}
};

const finishServerRenderAndCancel = (engine: Engine): void => {
	cancelTaskAndRunCleanup(engine.inner);
	cancelTaskAndRunCleanup(engine.outer);
	engine.inner = engine.outer = engine.renderer = null;
};
