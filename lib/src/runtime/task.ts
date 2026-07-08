import { ValueOf } from "../parser/types";
import { ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/guards";
import { isTemplate, TemplateValue } from "../template";

export const TASK_STATE = {
	DRIVING: 0,
	SUSPENDED: 1,
	DONE: 2,
	FAILED: 3,
} as const;

export const ROLE = { OUTER: 0, INNER: 1 } as const;

export const OPERATION = {
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

export const STEP_OUTCOME = {
	YIELDED: 0,
	RETURNED: 1,
	THREW: 2,
	RESUMED: 3,
} as const;

type OperationKind = ValueOf<typeof OPERATION>;
type StepOutcomeKind = ValueOf<typeof STEP_OUTCOME>;

export interface Task {
	generator: Generator | AsyncGenerator;
	role: ValueOf<typeof ROLE>;
	state: ValueOf<typeof TASK_STATE>;
	cleanup: VoidFunction | null;
}

export type Operation =
	| { kind: typeof OPERATION.PAINT; payload: TemplateValue }
	| { kind: typeof OPERATION.PAINT_FROM; payload: RenderFunction }
	| { kind: typeof OPERATION.INSTALL; payload: ComponentGenerator }
	| { kind: typeof OPERATION.RESUME; payload: unknown }
	| { kind: typeof OPERATION.AWAIT; payload: Promise<unknown> }
	| { kind: typeof OPERATION.COMPLETED; payload: null }
	| { kind: typeof OPERATION.THROW_TO_PARENT; payload: unknown }
	| { kind: typeof OPERATION.FAIL; payload: unknown }
	| { kind: typeof OPERATION.NOOP; payload: null };

export type StepOutcome =
	| { kind: typeof STEP_OUTCOME.YIELDED; payload: unknown }
	| { kind: typeof STEP_OUTCOME.RETURNED; payload: unknown }
	| { kind: typeof STEP_OUTCOME.THREW; payload: unknown }
	| { kind: typeof STEP_OUTCOME.RESUMED; payload: unknown };

const operationCell = {
	kind: OPERATION.NOOP as OperationKind,
	payload: null as unknown,
};
const stepOutcomeCell = {
	kind: STEP_OUTCOME.YIELDED as StepOutcomeKind,
	payload: null as unknown,
};

const createOperation = <K extends OperationKind>(
	kind: K,
	payload: Extract<Operation, { kind: K }>["payload"],
): Extract<Operation, { kind: K }> => {
	operationCell.kind = kind;
	operationCell.payload = payload;
	return operationCell as unknown as Extract<Operation, { kind: K }>;
};

export const createStepOutcome = (
	kind: StepOutcomeKind,
	payload: unknown,
): StepOutcome => {
	stepOutcomeCell.kind = kind;
	stepOutcomeCell.payload = payload;
	return stepOutcomeCell as unknown as StepOutcome;
};

export const nextOperation = (
	task: Task,
	incomingOutcome: StepOutcome,
): Operation => {
	switch (task.state) {
		case TASK_STATE.DRIVING:
			switch (incomingOutcome.kind) {
				case STEP_OUTCOME.YIELDED: {
					const value = incomingOutcome.payload;
					if (isTemplate(value)) return createOperation(OPERATION.PAINT, value);
					if (isGeneratorFunction(value)) {
						if (task.role === ROLE.INNER) {
							task.state = TASK_STATE.FAILED;
							return createOperation(
								OPERATION.THROW_TO_PARENT,
								new Error("Inner generators cannot yield generator functions"),
							);
						}
						return createOperation(
							OPERATION.INSTALL,
							value as ComponentGenerator,
						);
					}
					if (typeof value === "function")
						return createOperation(
							OPERATION.PAINT_FROM,
							value as RenderFunction,
						);
					if (value instanceof Promise) {
						task.state = TASK_STATE.SUSPENDED;
						return createOperation(OPERATION.AWAIT, value);
					}
					return createOperation(OPERATION.RESUME, value);
				}
				case STEP_OUTCOME.RETURNED:
					task.cleanup =
						typeof incomingOutcome.payload === "function"
							? (incomingOutcome.payload as VoidFunction)
							: null;
					task.state = TASK_STATE.DONE;
					return createOperation(OPERATION.COMPLETED, null);
				case STEP_OUTCOME.THREW:
					task.state = TASK_STATE.FAILED;
					return task.role === ROLE.INNER
						? createOperation(
								OPERATION.THROW_TO_PARENT,
								incomingOutcome.payload,
							)
						: createOperation(OPERATION.FAIL, incomingOutcome.payload);
			}
			break;

		case TASK_STATE.SUSPENDED:
			if (incomingOutcome.kind === STEP_OUTCOME.RESUMED) {
				task.state = TASK_STATE.DRIVING;
				return createOperation(OPERATION.RESUME, incomingOutcome.payload);
			}
			if (incomingOutcome.kind === STEP_OUTCOME.THREW) {
				task.state = TASK_STATE.FAILED;
				return task.role === ROLE.INNER
					? createOperation(OPERATION.THROW_TO_PARENT, incomingOutcome.payload)
					: createOperation(OPERATION.FAIL, incomingOutcome.payload);
			}
			break;
	}
	return createOperation(OPERATION.NOOP, null);
};
