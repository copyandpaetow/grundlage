import { ValueOf } from "../parser/types";
import { ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/guards";
import { paint, teardownPainter } from "./painter";
import {
	cancelEngineAndNotifyHost,
	cancelTaskAndRunCleanup,
	createCleanStepOutcome,
	createRenderTask,
	Engine,
	isTaskLive,
	MODE,
	nextTaskStep,
	resetInnerTask,
	resolvePendingUpdatePromise,
	SteppedTask,
} from "./engine";
import {
	createStepOutcome,
	nextOperation,
	OPERATION,
	ROLE,
	STEP_OUTCOME,
	Task,
	TASK_STATE,
} from "./task";

const OUTCOME = { SUSPENDED: 0, DONE: 1, THREW_UP: 2, FAILED: 3 } as const;
type Outcome = ValueOf<typeof OUTCOME>;

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
				//run the outer to whatever it did next: a re-yield paints a fallback, a
				//return completes it (cleanup captured, deferred to disconnect like COMPLETED)
				runTask(engine, parent, reaction);
				//a return left no live renderer — drop the dead child so update() can't re-run it
				if (dismissed) engine.renderer = null;
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
