import { ComponentGenerator, RenderFunction } from "../types";
import {
	RECOVERY_ATTEMPT_TYPE,
	TEMPLATE_SOURCE_TYPE,
} from "../utils/constants";

export type StaticTemplateSource = {
	type: typeof TEMPLATE_SOURCE_TYPE.STATIC;
};

export type RenderFunctionSource = {
	type: typeof TEMPLATE_SOURCE_TYPE.RENDER_FUNCTION;
	render: RenderFunction;
};

export type GeneratorTemplateSource = {
	type: typeof TEMPLATE_SOURCE_TYPE.GENERATOR;
	createGenerator: ComponentGenerator;
	generator: Generator | AsyncGenerator;
	cleanup: VoidFunction | null;
	terminated: boolean;
};

export type TemplateSource =
	| StaticTemplateSource
	| RenderFunctionSource
	| GeneratorTemplateSource;

export type OnYield = (
	source: GeneratorTemplateSource,
	value: unknown,
) => unknown;
export type OnError = (error: Error) => void;

const captureCleanup = (source: GeneratorTemplateSource, value: unknown) => {
	source.terminated = true;
	if (typeof value === "function") {
		source.cleanup = value as VoidFunction;
	}
};

export const advanceGenerator = (
	source: GeneratorTemplateSource,
	step: IteratorResult<unknown> | Promise<IteratorResult<unknown>>,
	onYield: OnYield,
	onError: OnError,
): void => {
	while (true) {
		if (source.terminated) return;

		if (step instanceof Promise) {
			step.then(
				(resolved) => advanceGenerator(source, resolved, onYield, onError),
				(error) => {
					source.terminated = true;
					onError(error as Error);
				},
			);
			return;
		}

		if (step.done) {
			captureCleanup(source, step.value);
			return;
		}

		if (step.value instanceof Promise) {
			step.value.then(
				(resolved) =>
					advanceGenerator(
						source,
						{ done: false, value: resolved },
						onYield,
						onError,
					),
				(error) => onError(error as Error),
			);
			return;
		}

		let result: unknown;
		try {
			result = onYield(source, step.value);
		} catch (error) {
			onError(error as Error);
			return;
		}

		try {
			step = source.generator.next(result);
		} catch (error) {
			source.terminated = true;
			onError(error as Error);
			return;
		}
	}
};

type RecoveryAttempt =
	| {
			type: typeof RECOVERY_ATTEMPT_TYPE.CAUGHT;
			step: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	  }
	| {
			type: typeof RECOVERY_ATTEMPT_TYPE.UNCAUGHT;
			error: Error;
	  };

const tryThrowInto = (
	source: GeneratorTemplateSource,
	error: Error,
): RecoveryAttempt => {
	try {
		const step = (source.generator as Generator).throw(error);
		return { type: RECOVERY_ATTEMPT_TYPE.CAUGHT, step };
	} catch (uncaught) {
		return { type: RECOVERY_ATTEMPT_TYPE.UNCAUGHT, error: uncaught as Error };
	}
};

export const deliverErrorToGenerator = (
	source: GeneratorTemplateSource,
	error: Error,
	onYield: OnYield,
	onError: OnError,
): void => {
	if (source.terminated) return;

	const attempt = tryThrowInto(source, error);
	if (attempt.type === RECOVERY_ATTEMPT_TYPE.UNCAUGHT) {
		source.terminated = true;
		onError(attempt.error);
		return;
	}

	advanceGenerator(source, attempt.step, onYield, onError);
};

export const cancelGenerator = (source: GeneratorTemplateSource) => {
	if (source.terminated) return;
	source.terminated = true;
	try {
		//calling .return() lets the generator run any try/finally cleanup the user wrote
		//for async generators .return() returns a Promise — we deliberately don't await it because the source is already marked terminated above, so any later resume will bail in advanceGenerator anyway
		(source.generator as Generator).return?.(undefined);
	} catch {
		//if the user's finally block throws we swallow the error here so the rest of the cancellation chain (other sources, cleanups) still runs
	}
};
