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
	THROW_INTO: 9,
} as const;

export const STEP_OUTCOME = {
	YIELDED: 0,
	RETURNED: 1,
	THREW: 2,
	RESUMED: 3,
} as const;

export const MODE = { SEND: 0, THROW: 1 } as const;

type OperationKind = ValueOf<typeof OPERATION>;
type StepOutcomeKind = ValueOf<typeof STEP_OUTCOME>;

export interface Task {
	generator: Generator | AsyncGenerator;
	role: ValueOf<typeof ROLE>;
	state: ValueOf<typeof TASK_STATE>;
	cleanup: VoidFunction | null;
}

export const createRenderTask = (
	role: ValueOf<typeof ROLE>,
	generator: Generator | AsyncGenerator,
): Task => ({
	generator,
	role,
	state: TASK_STATE.DRIVING,
	cleanup: null,
});

export type Operation =
	| { kind: typeof OPERATION.PAINT; payload: TemplateValue }
	| { kind: typeof OPERATION.PAINT_FROM; payload: RenderFunction }
	| { kind: typeof OPERATION.INSTALL; payload: ComponentGenerator }
	| { kind: typeof OPERATION.RESUME; payload: unknown }
	| { kind: typeof OPERATION.AWAIT; payload: Promise<unknown> }
	| { kind: typeof OPERATION.COMPLETED; payload: null }
	| { kind: typeof OPERATION.THROW_TO_PARENT; payload: unknown }
	| { kind: typeof OPERATION.FAIL; payload: unknown }
	| { kind: typeof OPERATION.NOOP; payload: null }
	| { kind: typeof OPERATION.THROW_INTO; payload: unknown };

export type StepOutcome =
	| { kind: typeof STEP_OUTCOME.YIELDED; payload: unknown }
	| { kind: typeof STEP_OUTCOME.RETURNED; payload: unknown }
	| { kind: typeof STEP_OUTCOME.THREW; payload: unknown }
	| { kind: typeof STEP_OUTCOME.RESUMED; payload: unknown };

export type SteppedTask = StepOutcome | Promise<IteratorResult<unknown>>;

//singleton cells: module state avoids per-frame allocation on the update() path (an animation
//calls update() every frame). Aliasing contract: a returned cell is valid only until the next
//createOperation/createStepOutcome call — read kind/payload out before any nested step reuses
//it, and never re-read it after.
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
				//throw the rejection back into the generator at its `yield promise` point so a
				//try/catch there can recover; an uncaught throw re-surfaces as a DRIVING THREW
				task.state = TASK_STATE.DRIVING;
				return createOperation(OPERATION.THROW_INTO, incomingOutcome.payload);
			}
			break;
	}
	return createOperation(OPERATION.NOOP, null);
};

export const cancelTaskAndRunCleanup = (task: Task | null): void => {
	if (task === null) return;
	let ending: unknown;
	try {
		ending = task.generator.return?.(undefined);
	} catch {
		/* a generator that throws on return() is already dead; nothing left to salvage */
	}
	// the engine is being torn down, so there is no live onError channel to route to
	if (ending instanceof Promise) ending.catch(console.warn);
	const cleanup = task.cleanup;
	if (cleanup !== null) {
		task.cleanup = null;
		cleanup();
	}
};

export const createCleanStepOutcome = (
	result: IteratorResult<unknown>,
): StepOutcome =>
	result.done
		? createStepOutcome(STEP_OUTCOME.RETURNED, result.value)
		: createStepOutcome(STEP_OUTCOME.YIELDED, result.value);

export const nextTaskStep = (
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
