import { Cleanup, UpdateGenerator } from "../types";
import type { ComponentRunner } from "./driver";
import {
	libraryMessage,
	reportErrorFromUserCode,
	warnDuringDevelopment,
} from "../utils/diagnostics";

const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(
	async function* () {},
);

//a generator function's props signature is unknowable at runtime, so the narrowing is wider than the
//check: any generator function reads as an UpdateGenerator
export const isGeneratorFunction = (value: unknown): value is UpdateGenerator =>
	typeof value === "function" &&
	Object.getPrototypeOf(value) === generatorFunctionPrototype;

//there is no global Generator constructor to test with instanceof, but every generator object carries
//this tag, from whichever realm made it
export const isGeneratorObject = (value: unknown): boolean =>
	Object.prototype.toString.call(value) === "[object Generator]";

export const isAsyncGeneratorFunction = (value: unknown): boolean =>
	typeof value === "function" &&
	Object.getPrototypeOf(value) === asyncGeneratorFunctionPrototype;

//a template yield is resumed by its own paint and an update generator yield by the run it waits
//for, never by a continuation, so neither needs an identity
export const PARKED_AT_TEMPLATE_OR_UPDATE_GENERATOR_YIELD: unique symbol =
	Symbol("parked at template or update generator yield");

//the promise a run waits on is its resume permit: only that promise's continuation may step it
export type Suspension =
	typeof PARKED_AT_TEMPLATE_OR_UPDATE_GENERATOR_YIELD | Promise<unknown>;

export interface Run {
	runner: ComponentRunner;
	generator: Generator<unknown, unknown, unknown>;
	suspension: Suspension | null;
	cleanup: Cleanup | null;
}

export const createRun = (
	runner: ComponentRunner,
	generator: Generator<unknown, unknown, unknown>,
): Run => ({
	runner,
	generator,
	suspension: null,
	cleanup: null,
});

export const isParkedAtTemplateOrUpdateGeneratorYield = (run: Run): boolean =>
	run.suspension === PARKED_AT_TEMPLATE_OR_UPDATE_GENERATOR_YIELD;

export const isStillParkedAt = (run: Run, promise: Promise<unknown>): boolean =>
	run.suspension === promise;

const TEARDOWN_INTERRUPTED_MESSAGE =
	"a new run started while a torn-down generator was still waiting in its finally block, so the rest of that block never ran. Move work that must finish out of the finally block, or do not yield there";
const TEARDOWN_YIELDED_NON_PROMISE_MESSAGE = libraryMessage(
	"a generator being torn down yields only promises: a template or an update generator yielded from a finally block has nothing to paint into. Paint before the teardown, or yield the promise alone",
);

//a teardown is cut off by a run that took the place it held: a remount, or a new update generator run
interface TeardownPlace {
	bodyRun: Run | null;
	updateGeneratorRun: Run | null;
}

const isTeardownPlaceTaken = (
	runner: ComponentRunner,
	place: TeardownPlace,
): boolean =>
	runner.bodyRun !== place.bodyRun ||
	runner.updateGeneratorRun !== place.updateGeneratorRun;

//the async function sits outside tearDownRun, so a finally block that does not yield
//never pays for its promise. Every turn waits on a promise the finally block yielded
const driveTeardownUntilDone = async (
	run: Run,
	firstResult: IteratorResult<unknown>,
	place: TeardownPlace,
): Promise<void> => {
	let result = firstResult;
	while (!result.done) {
		if (!(result.value instanceof Promise)) {
			reportErrorFromUserCode(new Error(TEARDOWN_YIELDED_NON_PROMISE_MESSAGE));
			return;
		}
		let settledValue: unknown;
		let rejection: unknown;
		let isRejected = false;
		try {
			settledValue = await result.value;
		} catch (error) {
			isRejected = true;
			rejection = error;
		}
		if (isTeardownPlaceTaken(run.runner, place)) {
			warnDuringDevelopment(TEARDOWN_INTERRUPTED_MESSAGE);
			return;
		}
		try {
			result = isRejected
				? run.generator.throw(rejection)
				: run.generator.next(settledValue);
		} catch (error) {
			reportErrorFromUserCode(error);
			return;
		}
	}
};

export const tearDownRun = (run: Run): void => {
	run.suspension = null;
	const runner = run.runner;
	try {
		const result = run.generator.return(undefined);
		if (!result.done)
			void driveTeardownUntilDone(run, result, {
				bodyRun: runner.bodyRun,
				updateGeneratorRun: runner.updateGeneratorRun,
			});
	} catch (error) {
		//the caller still has a sibling cleanup to run and a paint to make after this
		reportErrorFromUserCode(error);
	}
	const cleanup = run.cleanup;
	if (cleanup === null) return;
	run.cleanup = null;
	try {
		cleanup();
	} catch (error) {
		//a torn-down generator has no yield left to surface at, and the caller still has a sibling
		//cleanup to run and a paint to make after this, so it is reported instead of thrown
		reportErrorFromUserCode(error);
	}
};
