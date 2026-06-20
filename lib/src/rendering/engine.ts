import { ValueOf } from "../parser/types";
import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { paint, Painter, serverPaint, teardownPainter } from "./painter";
import { HTMLTemplate } from "./template-html";
import {
	getTaskResult,
	RESULT,
	ROLE,
	STEP_EVENT,
	StepEvent,
	Task,
	TASK_STATE,
	updateStepEvent,
} from "./task";

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

//todo: would inlining this to updateStepEvent(result.done ? EVENT.RETURNED : EVENT.YIELDED, result.value) and removing this function increase readability?
//if not, the name needs some work
const getNextStepEvent = (result: IteratorResult<unknown>): StepEvent =>
	result.done
		? updateStepEvent(STEP_EVENT.RETURNED, result.value)
		: updateStepEvent(STEP_EVENT.YIELDED, result.value);

const nextTaskStep = (
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
		return updateStepEvent(STEP_EVENT.THREW, error);
	}
	return stepped instanceof Promise ? stepped : getNextStepEvent(stepped);
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
	start: StepEvent | Promise<IteratorResult<unknown>> = nextTaskStep(
		task,
		MODE.SEND,
		undefined,
	),
): Outcome => {
	let next = start;
	while (true) {
		if (next instanceof Promise) {
			next.then(
				(result) => {
					if (isTaskLive(engine, task))
						runTask(engine, task, getNextStepEvent(result));
				},
				(error) => {
					if (isTaskLive(engine, task))
						runTask(engine, task, updateStepEvent(STEP_EVENT.THREW, error));
				},
			);
			return OUTCOME.SUSPENDED;
		}

		const taskResult = getTaskResult(task, next);
		switch (taskResult.kind) {
			case RESULT.PAINT:
				if (task.role === ROLE.OUTER) engine.renderer = null;
				try {
					paint(engine.painter, taskResult.payload);
				} catch (error) {
					next = updateStepEvent(STEP_EVENT.THREW, error);
					break;
				}
				next = nextTaskStep(task, MODE.SEND, engine.host);
				break;

			case RESULT.PAINT_FROM:
				if (task.role === ROLE.OUTER) engine.renderer = taskResult.payload;
				try {
					paint(engine.painter, taskResult.payload(engine.host));
				} catch (error) {
					next = updateStepEvent(STEP_EVENT.THREW, error);
					break;
				}
				next = nextTaskStep(task, MODE.SEND, engine.host);
				break;

			case RESULT.RESUME:
				next = nextTaskStep(task, MODE.SEND, taskResult.payload);
				break;

			case RESULT.INSTALL: {
				engine.renderer = taskResult.payload;
				const innerOutcome = runTask(
					engine,
					resetInnerTask(engine, taskResult.payload),
				);
				if (innerOutcome === OUTCOME.THREW_UP) return OUTCOME.THREW_UP;
				next = nextTaskStep(task, MODE.SEND, engine.host);
				break;
			}

			case RESULT.AWAIT: {
				const promise = taskResult.payload;
				promise.then(
					(value) => {
						if (isTaskLive(engine, task))
							runTask(engine, task, updateStepEvent(STEP_EVENT.RESUMED, value));
					},
					(error) => {
						if (isTaskLive(engine, task))
							runTask(engine, task, updateStepEvent(STEP_EVENT.THREW, error));
					},
				);
				return OUTCOME.SUSPENDED;
			}

			case RESULT.THROW_TO_PARENT: {
				const error = taskResult.payload;
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
					reaction.kind === STEP_EVENT.RETURNED;
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

			case RESULT.COMPLETED:
				if (task.role === ROLE.INNER) resolvePendingUpdatePromise(engine);
				return OUTCOME.DONE;

			case RESULT.FAIL:
				cancelEngineAndNotifyHost(engine, taskResult.payload);
				return OUTCOME.FAILED;

			case RESULT.NOOP:
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
	start: StepEvent | Promise<IteratorResult<unknown>> = nextTaskStep(
		task,
		MODE.SEND,
		undefined,
	),
): void => {
	let next = start;
	while (true) {
		if (next instanceof Promise) {
			next.then(
				(result) => runServerTask(engine, task, getNextStepEvent(result)),
				(error) => cancelEngineAndNotifyHost(engine, error),
			);
			return;
		}

		const taskResult = getTaskResult(task, next);
		switch (taskResult.kind) {
			case RESULT.PAINT:
			case RESULT.PAINT_FROM: {
				let template: HTMLTemplate;
				try {
					template =
						taskResult.kind === RESULT.PAINT
							? taskResult.payload
							: (taskResult.payload as RenderFunction)(engine.host);
				} catch (error) {
					next = updateStepEvent(STEP_EVENT.THREW, error);
					break;
				}
				serverPaint(engine.painter, template);
				return finishServerRenderAndCancel(engine);
			}

			case RESULT.INSTALL:
				return runServerTask(
					engine,
					resetInnerTask(engine, taskResult.payload),
				);

			case RESULT.RESUME:
				next = nextTaskStep(task, MODE.SEND, taskResult.payload);
				break;

			case RESULT.AWAIT:
				taskResult.payload.then(
					(value) =>
						runServerTask(
							engine,
							task,
							updateStepEvent(STEP_EVENT.RESUMED, value),
						),
					(error) => cancelEngineAndNotifyHost(engine, error),
				);
				return;

			case RESULT.THROW_TO_PARENT: {
				const error = taskResult.payload;
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

			case RESULT.COMPLETED:
				return finishServerRenderAndCancel(engine);

			case RESULT.FAIL:
				return cancelEngineAndNotifyHost(engine, taskResult.payload);

			case RESULT.NOOP:
				return;
		}
	}
};

const finishServerRenderAndCancel = (engine: Engine): void => {
	cancelTaskAndRunCleanup(engine.inner);
	cancelTaskAndRunCleanup(engine.outer);
	engine.inner = engine.outer = engine.renderer = null;
};
