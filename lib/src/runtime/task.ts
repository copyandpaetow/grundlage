import { Cleanup, ComponentGenerator } from "../types";
import type { RenderRun } from "./driver";
import { reportErrorFromUserCode } from "../utils/diagnostics";

const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(
	async function* () {},
);

//a generator function's props signature is unknowable at runtime, so the narrowing is wider than the
//check: any generator function reads as a ComponentGenerator
export const isGeneratorFunction = (
	value: unknown,
): value is ComponentGenerator => {
	if (typeof value !== "function") return false;
	const prototype = Object.getPrototypeOf(value);
	return (
		prototype === generatorFunctionPrototype ||
		prototype === asyncGeneratorFunctionPrototype
	);
};

//identity is the resume permit: a continuation may only step the task still parked on its own
export interface Suspension {
	isAtRenderableYield: boolean;
}

type GeneratorStepResult =
	IteratorResult<unknown> | Promise<IteratorResult<unknown>>;

//a union of Generator and AsyncGenerator cannot be stepped without picking one of the two call
//signatures, so the task names the shape both of them answer to
interface SteppableGenerator {
	next(value: unknown): GeneratorStepResult;
	throw(error: unknown): GeneratorStepResult;
	return?(value: unknown): unknown;
}

export interface Task {
	run: RenderRun;
	generator: SteppableGenerator;
	suspension: Suspension | null;
	cleanup: Cleanup | null;
	//always null on a nested task itself: nesting is one level deep, and one shape for both keeps
	//every site that steps a task monomorphic
	nestedGeneratorTask: Task | null;
}

export const createRenderTask = (
	run: RenderRun,
	generator: SteppableGenerator,
): Task => ({
	run,
	generator,
	suspension: null,
	cleanup: null,
	nestedGeneratorTask: null,
});

export const isParkedAtRenderableYield = (task: Task): boolean =>
	task.suspension?.isAtRenderableYield === true;

export const isStillParkedAt = (
	task: Task,
	suspension: Suspension | null,
): boolean => suspension !== null && task.suspension === suspension;

export const cancelTaskAndRunCleanup = (task: Task): void => {
	task.suspension = null;
	let ending: unknown;
	try {
		ending = task.generator.return?.(undefined);
	} catch {
		/* a generator that throws on return() is already dead; nothing left to salvage */
	}
	if (ending instanceof Promise) ending.catch(reportErrorFromUserCode);
	const cleanup = task.cleanup;
	if (cleanup === null) return;
	task.cleanup = null;
	try {
		cleanup();
	} catch (error) {
		//a torn-down generator has no yield left to surface at, and the caller still has a sibling
		//cleanup to run and a paint to make after this, so it is reported instead of thrown
		reportErrorFromUserCode(error);
	}
};
