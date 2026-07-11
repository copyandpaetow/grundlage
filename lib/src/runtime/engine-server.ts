import { RenderFunction } from "../types";
import { TemplateValue } from "../template";
import { serverPaint } from "./painter";
import {
	cancelBothTasks,
	cancelEngineAndNotifyHost,
	cancelTaskAndRunCleanup,
	createCleanStepOutcome,
	Engine,
	MODE,
	nextTaskStep,
	resetInnerTask,
	SteppedTask,
} from "./engine";
import {
	createRenderTask,
	createStepOutcome,
	nextOperation,
	OPERATION,
	ROLE,
	STEP_OUTCOME,
	Task,
	TASK_STATE,
} from "./task";

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
				let template: TemplateValue;
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
				return cancelBothTasks(engine);
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
				return cancelBothTasks(engine);

			case OPERATION.FAIL:
				return cancelEngineAndNotifyHost(engine, operation.payload);

			case OPERATION.NOOP:
				return;
		}
	}
};
