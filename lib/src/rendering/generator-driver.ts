import { GeneratorFn, TemplateRenderer } from "../types";

export const EPOCH_TYPE = {
	STATIC: 0,
	RENDERER: 1,
	GENERATOR: 2,
} as const;

export type StaticEpoch = {
	type: typeof EPOCH_TYPE.STATIC;
};

export type RendererEpoch = {
	type: typeof EPOCH_TYPE.RENDERER;
	renderer: TemplateRenderer;
};

export type GeneratorEpoch = {
	type: typeof EPOCH_TYPE.GENERATOR;
	generatorFn: GeneratorFn;
	generator: Generator | AsyncGenerator;
	cleanup: VoidFunction | null;
	done: boolean;
};

export type Epoch = StaticEpoch | RendererEpoch | GeneratorEpoch;

export type HandleYield = (epoch: GeneratorEpoch, value: unknown) => unknown;
export type HandleError = (error: Error) => void;

const captureCleanup = (epoch: GeneratorEpoch, value: unknown) => {
	epoch.done = true;
	if (typeof value === "function") {
		epoch.cleanup = value as VoidFunction;
	}
};

export const drive = (
	epoch: GeneratorEpoch,
	step: IteratorResult<unknown> | Promise<IteratorResult<unknown>>,
	handleYield: HandleYield,
	handleError: HandleError,
): void => {
	while (true) {
		if (epoch.done) return;

		if (step instanceof Promise) {
			step.then(
				(resolved) => drive(epoch, resolved, handleYield, handleError),
				(error) => {
					epoch.done = true;
					handleError(error as Error);
				},
			);
			return;
		}

		if (step.done) {
			captureCleanup(epoch, step.value);
			return;
		}

		if (step.value instanceof Promise) {
			step.value.then(
				(resolved) =>
					drive(
						epoch,
						{ done: false, value: resolved },
						handleYield,
						handleError,
					),
				(error) => handleError(error as Error),
			);
			return;
		}

		let result: unknown;
		try {
			result = handleYield(epoch, step.value);
		} catch (error) {
			handleError(error as Error);
			return;
		}

		try {
			step = epoch.generator.next(result);
		} catch (error) {
			epoch.done = true;
			handleError(error as Error);
			return;
		}
	}
};

export const throwInto = (
	epoch: GeneratorEpoch,
	error: Error,
	handleYield: HandleYield,
	handleError: HandleError,
): boolean => {
	if (epoch.done) return false;

	let step: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		step = (epoch.generator as Generator).throw(error);
	} catch (uncaught) {
		epoch.done = true;
		handleError(uncaught as Error);
		return true;
	}

	drive(epoch, step, handleYield, handleError);
	return true;
};

export const cancel = (epoch: GeneratorEpoch) => {
	if (epoch.done) return;
	epoch.done = true;
	try {
		// Fires user-level try/finally blocks. For async generators .return()
		// returns a Promise we deliberately don't await — cancellation is
		// best-effort and the epoch is already marked done.
		(epoch.generator as Generator).return?.(undefined);
	} catch {
		// User finally blocks may throw; swallow to keep teardown sequential.
	}
};
