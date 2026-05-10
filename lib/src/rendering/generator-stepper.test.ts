import { describe, expect, test, vi } from "vitest";
import {
	advanceGenerator,
	cancelGenerator,
	deliverErrorToGenerator,
	GeneratorTemplateSource,
} from "./generator-stepper";
import { ComponentGenerator } from "../types";
import { TEMPLATE_SOURCE_TYPE } from "../utils/constants";

const makeSource = (
	createGenerator: ComponentGenerator,
	element: unknown = null,
): GeneratorTemplateSource => {
	const generator = createGenerator(
		element as Parameters<ComponentGenerator>[0],
	);
	return {
		type: TEMPLATE_SOURCE_TYPE.GENERATOR,
		createGenerator,
		generator,
		cleanup: null,
		terminated: false,
	};
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("advanceGenerator — sync iteration", () => {
	test("walks every yield through onYield until terminated", () => {
		const yields: unknown[] = [];
		const source = makeSource(function* () {
			yield "a";
			yield "b";
			yield "c";
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			(_source, value) => {
				yields.push(value);
				return undefined;
			},
			() => {},
		);

		expect(yields).toEqual(["a", "b", "c"]);
		expect(source.terminated).toBe(true);
	});

	test("captures returned function as cleanup on completion", () => {
		const cleanupSpy = vi.fn();
		const source = makeSource(function* () {
			yield 1;
			return cleanupSpy;
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			() => {},
		);

		expect(source.terminated).toBe(true);
		expect(source.cleanup).toBe(cleanupSpy);
		// advanceGenerator doesn't invoke cleanup itself — only captures it
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("ignores non-function return values for cleanup", () => {
		const source = makeSource(function* () {
			yield 1;
			return "not a function";
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			() => {},
		);

		expect(source.terminated).toBe(true);
		expect(source.cleanup).toBeNull();
	});

	test("feeds onYield's return value back into generator.next", () => {
		const observed: unknown[] = [];
		const source = makeSource(function* () {
			const first = yield "first";
			observed.push(first);
			const second = yield "second";
			observed.push(second);
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			(_source, value) => `echo:${value as string}`,
			() => {},
		);

		expect(observed).toEqual(["echo:first", "echo:second"]);
	});

	test("returns early when source is already terminated", () => {
		const onYield = vi.fn();
		const source = makeSource(function* () {
			yield "should not reach";
		});
		source.terminated = true;

		advanceGenerator(
			source,
			source.generator.next(undefined),
			onYield,
			() => {},
		);

		expect(onYield).not.toHaveBeenCalled();
	});
});

describe("advanceGenerator — error paths", () => {
	test("onYield throw routes to onError without advancing generator", () => {
		const onError = vi.fn();
		const generatorNextSpy = vi.fn();

		const source = makeSource(function* () {
			yield "boom";
			generatorNextSpy();
			yield "after";
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => {
				throw new Error("yield-handler-failed");
			},
			onError,
		);

		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0][0] as Error).message).toBe(
			"yield-handler-failed",
		);
		expect(generatorNextSpy).not.toHaveBeenCalled();
		// source.terminated is NOT set on onYield throws — only the generator's
		// own throws and cancellation set terminated. onError owns the policy
		// decision.
		expect(source.terminated).toBe(false);
	});

	test("generator.next throw marks source terminated and routes to onError", () => {
		const onError = vi.fn();
		const source = makeSource(function* () {
			yield "ok";
			throw new Error("inside-generator");
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			onError,
		);

		expect(source.terminated).toBe(true);
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0][0] as Error).message).toBe(
			"inside-generator",
		);
	});
});

describe("advanceGenerator — async generator and yielded promises", () => {
	test("awaits a promise step (async generator) and resumes", async () => {
		const yields: unknown[] = [];
		const source = makeSource(async function* () {
			yield "first";
			yield "second";
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			(_source, value) => {
				yields.push(value);
				return undefined;
			},
			() => {},
		);

		await flush();
		expect(yields).toEqual(["first", "second"]);
		expect(source.terminated).toBe(true);
	});

	test("a yielded promise is unwrapped and resolved value flows to onYield", async () => {
		const onYieldSpy = vi.fn().mockReturnValue(undefined);
		const source = makeSource(function* () {
			yield Promise.resolve("payload");
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			onYieldSpy,
			() => {},
		);

		await flush();
		expect(onYieldSpy).toHaveBeenCalledOnce();
		expect(onYieldSpy.mock.calls[0][1]).toBe("payload");
		expect(source.terminated).toBe(true);
	});

	test("rejected yielded promise routes to onError; source.terminated stays false", async () => {
		const onError = vi.fn();
		const source = makeSource(function* () {
			yield Promise.reject(new Error("rejected-yield"));
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			onError,
		);

		await flush();
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0][0] as Error).message).toBe("rejected-yield");
		// Yielded-promise rejections are policy decisions for the consumer; the
		// driver leaves source.terminated so the consumer can choose to continue
		// or cancel.
		expect(source.terminated).toBe(false);
	});

	test("rejected step (async generator throw) marks source terminated and reports error", async () => {
		const onError = vi.fn();
		const source = makeSource(async function* () {
			throw new Error("async-throw");
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			onError,
		);

		await flush();
		expect(source.terminated).toBe(true);
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0][0] as Error).message).toBe("async-throw");
	});

	test("late async resumption into a cancelled source is suppressed", async () => {
		const onYield = vi.fn().mockReturnValue(undefined);
		const onError = vi.fn();
		let resolveStep: (value: unknown) => void = () => {};
		const pending = new Promise((resolve) => {
			resolveStep = resolve;
		});

		const source = makeSource(function* () {
			yield pending;
			yield "after-await";
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			onYield,
			onError,
		);

		cancelGenerator(source);
		resolveStep("late");
		await flush();

		expect(onYield).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
});

describe("deliverErrorToGenerator", () => {
	test("is a no-op for an already-terminated source", () => {
		const onError = vi.fn();
		const onYield = vi.fn();
		const source = makeSource(function* () {
			yield 1;
		});
		source.terminated = true;

		deliverErrorToGenerator(source, new Error("nope"), onYield, onError);

		expect(onError).not.toHaveBeenCalled();
		expect(onYield).not.toHaveBeenCalled();
	});

	test("delivers error to a generator that catches and continues", () => {
		const recovered: unknown[] = [];
		const source = makeSource(function* () {
			try {
				yield "before";
			} catch (error) {
				recovered.push((error as Error).message);
				yield "after-catch";
			}
		});

		// Park the generator at the first yield without running the loop —
		// advanceGenerator() would synchronously walk to completion since onYield
		// returns undefined.
		source.generator.next(undefined);

		deliverErrorToGenerator(
			source,
			new Error("recover-me"),
			(_source, value) => {
				recovered.push(value);
				return undefined;
			},
			() => {},
		);

		expect(recovered).toEqual(["recover-me", "after-catch"]);
	});

	test("uncaught throw marks source terminated and reports through onError", () => {
		const onError = vi.fn();
		const source = makeSource(function* () {
			yield "parked";
		});

		source.generator.next(undefined);

		deliverErrorToGenerator(
			source,
			new Error("uncaught"),
			() => undefined,
			onError,
		);

		expect(source.terminated).toBe(true);
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0][0] as Error).message).toBe("uncaught");
	});

	test("recovery yield can complete with cleanup capture", () => {
		const cleanupSpy = vi.fn();
		const source = makeSource(function* () {
			try {
				yield "wait";
			} catch {
				return cleanupSpy;
			}
		});

		source.generator.next(undefined);

		deliverErrorToGenerator(
			source,
			new Error("trigger-return"),
			() => undefined,
			() => {},
		);

		expect(source.terminated).toBe(true);
		expect(source.cleanup).toBe(cleanupSpy);
	});
});

describe("cancelGenerator", () => {
	test("invokes generator.return so user finally blocks fire", () => {
		const finallySpy = vi.fn();
		const source = makeSource(function* () {
			try {
				yield "parked";
				yield "never-reached";
			} finally {
				finallySpy();
			}
		});

		source.generator.next(undefined);
		expect(finallySpy).not.toHaveBeenCalled();

		cancelGenerator(source);

		expect(finallySpy).toHaveBeenCalledOnce();
		expect(source.terminated).toBe(true);
	});

	test("is idempotent", () => {
		const finallySpy = vi.fn();
		const source = makeSource(function* () {
			try {
				yield "parked";
				yield "never-reached";
			} finally {
				finallySpy();
			}
		});

		source.generator.next(undefined);

		cancelGenerator(source);
		cancelGenerator(source);
		cancelGenerator(source);

		expect(finallySpy).toHaveBeenCalledOnce();
	});

	test("swallows errors thrown by user finally blocks", () => {
		const source = makeSource(function* () {
			try {
				yield "parked";
				yield "never-reached";
			} finally {
				throw new Error("finally-boom");
			}
		});

		source.generator.next(undefined);

		expect(() => cancelGenerator(source)).not.toThrow();
		expect(source.terminated).toBe(true);
	});

	test("cancelling an async generator does not reject the un-awaited return promise", async () => {
		const source = makeSource(async function* () {
			yield "parked";
			yield "never-reached";
		});

		// Async generator: priming via .next() returns a promise. Resolve it so
		// the generator parks at "parked" before we cancel.
		await source.generator.next(undefined);

		expect(() => cancelGenerator(source)).not.toThrow();
		expect(source.terminated).toBe(true);
		await flush();
	});
});

// Reproduces the restart pattern used by index.ts#restartGenerator:
// cancelGenerator the current generator, swap source.generator for a fresh one,
// reset terminated=false, then advance the new generator on the SAME source object.
// The .then closures captured by advanceGenerator() during the first run still hold
// the same source reference, so any late resolution from the cancelled
// generator can still re-enter advanceGenerator(source, ...).
describe("source reuse across restart (regression for stale-resolution bug)", () => {
	test("late {done:true} from cancelled generator must not mark a freshly restarted source terminated", async () => {
		let resolveOldAwait: (() => void) | null = null;
		const oldAwait = new Promise<void>((resolve) => {
			resolveOldAwait = resolve;
		});

		const oldGenerator = async function* () {
			yield "old-first";
			await oldAwait;
			yield "old-second";
		};

		// Park gen at the await: advanceGenerator yields "old-first", calls onYield,
		// then enters the await on the next .next() and parks.
		const source = makeSource(oldGenerator);
		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			() => {},
		);
		await flush();

		// Restart pattern (mirrors index.ts#restartGenerator).
		cancelGenerator(source);
		const newYields: unknown[] = [];
		const newGenerator = async function* () {
			yield "new-first";
			await new Promise<void>((resolve) => setTimeout(resolve, 30));
			yield "new-second";
		};
		source.generator = newGenerator();
		source.cleanup = null;
		source.terminated = false;

		advanceGenerator(
			source,
			source.generator.next(undefined),
			(_source, value) => {
				newYields.push(value);
				return undefined;
			},
			() => {},
		);
		await flush();
		expect(newYields).toEqual(["new-first"]);

		// Resolve the cancelled generator's await. Its queued return resolves
		// the .next() promise advanceGenerator was waiting on with {done: true, value: undefined}.
		// The captured .then closure calls advanceGenerator(source, ...) on the SAME source —
		// which is now driving the new generator parked at its own await.
		resolveOldAwait?.();
		await new Promise((resolve) => setTimeout(resolve, 50));

		// If the bug is present, captureCleanup runs with the stale step,
		// source.terminated flips to true, and "new-second" never reaches onYield.
		expect(newYields).toEqual(["new-first", "new-second"]);
	});

	test("late {done:false, value} from cancelled generator must not flow into the restarted generator", async () => {
		// Edge case: the cancelled generator yielded a non-Promise value before
		// the cancel landed, but the .next() Promise hadn't resolved yet. When
		// it does resolve, advanceGenerator sees a yielded value and routes it through
		// onYield AND advances the source's now-replaced generator.
		let resolveOldStep: ((step: IteratorResult<unknown>) => void) | null = null;
		const queuedStep = new Promise<IteratorResult<unknown>>((resolve) => {
			resolveOldStep = resolve;
		});

		// Hand-rolled generator-like object so we can control exactly what its
		// .next() returns. advanceGenerator() only calls .next/.return/.throw, so this is
		// sufficient for the test.
		const oldGenerator = {
			next: () => queuedStep,
			return: () => Promise.resolve({ done: true, value: undefined }),
			throw: (error: unknown) => Promise.reject(error),
			[Symbol.asyncIterator]() {
				return this;
			},
		} as unknown as AsyncGenerator;

		const source: GeneratorTemplateSource = {
			type: TEMPLATE_SOURCE_TYPE.GENERATOR,
			createGenerator: (() => oldGenerator) as unknown as ComponentGenerator,
			generator: oldGenerator,
			cleanup: null,
			terminated: false,
		};

		const onYield = vi.fn().mockReturnValue(undefined);

		advanceGenerator(
			source,
			source.generator.next(undefined),
			onYield,
			() => {},
		);
		// Park: queuedStep is unresolved.

		// Restart pattern.
		cancelGenerator(source);
		const newYields: unknown[] = [];
		source.generator = (async function* () {
			yield "new-first";
			yield "new-second";
		})();
		source.cleanup = null;
		source.terminated = false;

		advanceGenerator(
			source,
			source.generator.next(undefined),
			(_source, value) => {
				newYields.push(value);
				return undefined;
			},
			() => {},
		);
		await flush();
		await flush();

		// Now resolve the queued step from the cancelled generator with a value
		// that LOOKS like a valid yield. With the bug, advanceGenerator() sees source.terminated=false,
		// runs onYield(source, "stale-value") on the new run's handler, then
		// calls source.generator.next(...) — advancing the NEW generator with the
		// echoed result. The new run is corrupted.
		resolveOldStep?.({ done: false, value: "stale-value" });
		await flush();
		await flush();

		expect(newYields).not.toContain("stale-value");
	});
});

// The cleanup contract today: source.cleanup is only set by captureCleanup,
// which runs when advanceGenerator() observes step.done. cancelGenerator() invokes
// generator.return() but does not feed the result back through advanceGenerator, so
// any `return cleanupFn` line the user wrote is unreachable when cancelGenerator
// fires before natural completion. These tests pin that behavior so any
// future change to cleanup-on-cancel is a deliberate decision, not a drift.
describe("cleanup capture vs cancelGenerator — current contract", () => {
	test("cleanup function from `return cleanupFn` is NOT captured when cancelled mid-await", async () => {
		const cleanupSpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		const source = makeSource(async function* () {
			yield "parked";
			await new Promise<void>((resolve) => {
				resolveAwait = resolve;
			});
			return cleanupSpy;
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			() => {},
		);
		await flush();

		cancelGenerator(source);

		// Even after the awaited promise settles, the queued .return() drains
		// past the explicit `return cleanupSpy` line — the body never reaches it.
		resolveAwait?.();
		await flush();
		await flush();

		expect(source.cleanup).toBeNull();
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("cleanup function IS captured when the generator completes naturally before cancelGenerator", () => {
		const cleanupSpy = vi.fn();
		const source = makeSource(function* () {
			yield "first";
			return cleanupSpy;
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			() => {},
		);

		expect(source.cleanup).toBe(cleanupSpy);

		// cancelGenerator after natural completion is a no-op for cleanup state.
		cancelGenerator(source);
		expect(source.cleanup).toBe(cleanupSpy);
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("try/finally is the only path that fires cancellation cleanup mid-await", async () => {
		const finallySpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		const source = makeSource(async function* () {
			yield "parked";
			try {
				await new Promise<void>((resolve) => {
					resolveAwait = resolve;
				});
			} finally {
				finallySpy();
			}
		});

		advanceGenerator(
			source,
			source.generator.next(undefined),
			() => undefined,
			() => {},
		);
		await flush();

		cancelGenerator(source);
		// Disconnect alone cannot unblock the pending await — finally has not
		// run yet. Documents the same constraint as the integration suite.
		expect(finallySpy).not.toHaveBeenCalled();

		resolveAwait?.();
		await flush();
		await flush();
		expect(finallySpy).toHaveBeenCalledTimes(1);
	});
});
