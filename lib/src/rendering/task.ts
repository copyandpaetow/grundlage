import { ValueOf } from "../parser/types";
import { ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { HTMLTemplate, isTemplate } from "./template-html";

export const TASK_STATE = {
	DRIVING: 0,
	SUSPENDED: 1,
	DONE: 2,
	FAILED: 3,
} as const;

export const ROLE = { OUTER: 0, INNER: 1 } as const;

export const RESULT = {
	PAINT: 0,
	PAINT_FROM: 1,
	INSTALL: 2,
	RESUME: 3,
	AWAIT: 4,
	COMPLETED: 5,
	THROW_TO_PARENT: 6,
	FAIL: 7,
	NOOP: 8,
} as const;

export const STEP_EVENT = {
	YIELDED: 0,
	RETURNED: 1,
	THREW: 2,
	RESUMED: 3,
} as const;

type ResultKind = ValueOf<typeof RESULT>;
type StepEventKind = ValueOf<typeof STEP_EVENT>;

export interface Task {
	generator: Generator | AsyncGenerator;
	role: ValueOf<typeof ROLE>;
	state: ValueOf<typeof TASK_STATE>;
	cleanup: VoidFunction | null;
}

export type RenderResult =
	| { kind: typeof RESULT.PAINT; payload: HTMLTemplate }
	| { kind: typeof RESULT.PAINT_FROM; payload: RenderFunction }
	| { kind: typeof RESULT.INSTALL; payload: ComponentGenerator }
	| { kind: typeof RESULT.RESUME; payload: unknown }
	| { kind: typeof RESULT.AWAIT; payload: Promise<unknown> }
	| { kind: typeof RESULT.COMPLETED; payload: null }
	| { kind: typeof RESULT.THROW_TO_PARENT; payload: unknown }
	| { kind: typeof RESULT.FAIL; payload: unknown }
	| { kind: typeof RESULT.NOOP; payload: null };

export type StepEvent =
	| { kind: typeof STEP_EVENT.YIELDED; payload: unknown }
	| { kind: typeof STEP_EVENT.RETURNED; payload: unknown }
	| { kind: typeof STEP_EVENT.THREW; payload: unknown }
	| { kind: typeof STEP_EVENT.RESUMED; payload: unknown };

const commandCell = {
	kind: RESULT.NOOP as ResultKind,
	payload: null as unknown,
};
const eventCell = {
	kind: STEP_EVENT.YIELDED as StepEventKind,
	payload: null as unknown,
};

const createTaskResult = <K extends ResultKind>(
	kind: K,
	payload: Extract<RenderResult, { kind: K }>["payload"],
): Extract<RenderResult, { kind: K }> => {
	commandCell.kind = kind;
	commandCell.payload = payload;
	return commandCell as unknown as Extract<RenderResult, { kind: K }>;
};

export const updateStepEvent = (
	kind: StepEventKind,
	payload: unknown,
): StepEvent => {
	eventCell.kind = kind;
	eventCell.payload = payload;
	return eventCell as unknown as StepEvent;
};

export const getTaskResult = (
	task: Task,
	incomingEvent: StepEvent,
): RenderResult => {
	switch (task.state) {
		case TASK_STATE.DRIVING:
			switch (incomingEvent.kind) {
				case STEP_EVENT.YIELDED: {
					const value = incomingEvent.payload;
					if (isTemplate(value)) return createTaskResult(RESULT.PAINT, value);
					if (isGeneratorFunction(value)) {
						if (task.role === ROLE.INNER) {
							task.state = TASK_STATE.FAILED;
							return createTaskResult(
								RESULT.THROW_TO_PARENT,
								new Error("Inner generators cannot yield generator functions"),
							);
						}
						return createTaskResult(
							RESULT.INSTALL,
							value as ComponentGenerator,
						);
					}
					if (typeof value === "function")
						return createTaskResult(RESULT.PAINT_FROM, value as RenderFunction);
					if (value instanceof Promise) {
						task.state = TASK_STATE.SUSPENDED;
						return createTaskResult(RESULT.AWAIT, value);
					}
					return createTaskResult(RESULT.RESUME, value);
				}
				case STEP_EVENT.RETURNED:
					task.cleanup =
						typeof incomingEvent.payload === "function"
							? (incomingEvent.payload as VoidFunction)
							: null;
					task.state = TASK_STATE.DONE;
					return createTaskResult(RESULT.COMPLETED, null);
				case STEP_EVENT.THREW:
					task.state = TASK_STATE.FAILED;
					return task.role === ROLE.INNER
						? createTaskResult(RESULT.THROW_TO_PARENT, incomingEvent.payload)
						: createTaskResult(RESULT.FAIL, incomingEvent.payload);
			}
			break;

		case TASK_STATE.SUSPENDED:
			if (incomingEvent.kind === STEP_EVENT.RESUMED) {
				task.state = TASK_STATE.DRIVING;
				return createTaskResult(RESULT.RESUME, incomingEvent.payload);
			}
			if (incomingEvent.kind === STEP_EVENT.THREW) {
				task.state = TASK_STATE.FAILED;
				return task.role === ROLE.INNER
					? createTaskResult(RESULT.THROW_TO_PARENT, incomingEvent.payload)
					: createTaskResult(RESULT.FAIL, incomingEvent.payload);
			}
			break;
	}
	return createTaskResult(RESULT.NOOP, null);
};
