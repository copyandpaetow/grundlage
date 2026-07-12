import { ValueOf } from "../parser/types";
import { createStepOutcome, STEP_OUTCOME, StepOutcome, Task } from "./task";

export const MODE = { SEND: 0, THROW: 1 } as const;

export type SteppedTask = StepOutcome | Promise<IteratorResult<unknown>>;

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
