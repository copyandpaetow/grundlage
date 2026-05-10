import { describe, expect, test, vi } from "vitest";
import { cancel, drive, GeneratorEpoch, throwInto } from "./generator-driver";
import { GeneratorFn } from "../types";
import { EPOCH_TYPE } from "../utils/constants";

const makeEpoch = (
	generatorFn: GeneratorFn,
	element: unknown = null,
): GeneratorEpoch => {
	const generator = generatorFn(element as Parameters<GeneratorFn>[0]);
	return {
		type: EPOCH_TYPE.GENERATOR,
		generatorFn,
		generator,
		cleanup: null,
		done: false,
	};
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("drive — sync iteration", () => {
	test("walks every yield through handleYield until done", () => {
		const yields: unknown[] = [];
		const epoch = makeEpoch(function* () {
			yield "a";
			yield "b";
			yield "c";
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			(_epoch, value) => {
				yields.push(value);
				return undefined;
			},
			() => {},
		);

		expect(yields).toEqual(["a", "b", "c"]);
		expect(epoch.done).toBe(true);
	});

	test("captures returned function as cleanup on completion", () => {
		const cleanupSpy = vi.fn();
		const epoch = makeEpoch(function* () {
			yield 1;
			return cleanupSpy;
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			() => {},
		);

		expect(epoch.done).toBe(true);
		expect(epoch.cleanup).toBe(cleanupSpy);
		// drive doesn't invoke cleanup itself — only captures it
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("ignores non-function return values for cleanup", () => {
		const epoch = makeEpoch(function* () {
			yield 1;
			return "not a function";
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			() => {},
		);

		expect(epoch.done).toBe(true);
		expect(epoch.cleanup).toBeNull();
	});

	test("feeds handleYield's return value back into generator.next", () => {
		const observed: unknown[] = [];
		const epoch = makeEpoch(function* () {
			const first = yield "first";
			observed.push(first);
			const second = yield "second";
			observed.push(second);
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			(_epoch, value) => `echo:${value as string}`,
			() => {},
		);

		expect(observed).toEqual(["echo:first", "echo:second"]);
	});

	test("returns early when epoch is already done", () => {
		const handleYield = vi.fn();
		const epoch = makeEpoch(function* () {
			yield "should not reach";
		});
		epoch.done = true;

		drive(epoch, epoch.generator.next(undefined), handleYield, () => {});

		expect(handleYield).not.toHaveBeenCalled();
	});
});

describe("drive — error paths", () => {
	test("handleYield throw routes to handleError without advancing generator", () => {
		const handleError = vi.fn();
		const generatorNextSpy = vi.fn();

		const epoch = makeEpoch(function* () {
			yield "boom";
			generatorNextSpy();
			yield "after";
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => {
				throw new Error("yield-handler-failed");
			},
			handleError,
		);

		expect(handleError).toHaveBeenCalledOnce();
		expect((handleError.mock.calls[0][0] as Error).message).toBe(
			"yield-handler-failed",
		);
		expect(generatorNextSpy).not.toHaveBeenCalled();
		// epoch.done is NOT set on handleYield throws — only the generator's own
		// throws and cancellation set done. handleError owns the policy decision.
		expect(epoch.done).toBe(false);
	});

	test("generator.next throw marks epoch done and routes to handleError", () => {
		const handleError = vi.fn();
		const epoch = makeEpoch(function* () {
			yield "ok";
			throw new Error("inside-generator");
		});

		drive(epoch, epoch.generator.next(undefined), () => undefined, handleError);

		expect(epoch.done).toBe(true);
		expect(handleError).toHaveBeenCalledOnce();
		expect((handleError.mock.calls[0][0] as Error).message).toBe(
			"inside-generator",
		);
	});
});

describe("drive — async generator and yielded promises", () => {
	test("awaits a promise step (async generator) and resumes", async () => {
		const yields: unknown[] = [];
		const epoch = makeEpoch(async function* () {
			yield "first";
			yield "second";
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			(_epoch, value) => {
				yields.push(value);
				return undefined;
			},
			() => {},
		);

		await flush();
		expect(yields).toEqual(["first", "second"]);
		expect(epoch.done).toBe(true);
	});

	test("a yielded promise is unwrapped and resolved value flows to handleYield", async () => {
		const handleYieldSpy = vi.fn().mockReturnValue(undefined);
		const epoch = makeEpoch(function* () {
			yield Promise.resolve("payload");
		});

		drive(epoch, epoch.generator.next(undefined), handleYieldSpy, () => {});

		await flush();
		expect(handleYieldSpy).toHaveBeenCalledOnce();
		expect(handleYieldSpy.mock.calls[0][1]).toBe("payload");
		expect(epoch.done).toBe(true);
	});

	test("rejected yielded promise routes to handleError; epoch.done stays false", async () => {
		const handleError = vi.fn();
		const epoch = makeEpoch(function* () {
			yield Promise.reject(new Error("rejected-yield"));
		});

		drive(epoch, epoch.generator.next(undefined), () => undefined, handleError);

		await flush();
		expect(handleError).toHaveBeenCalledOnce();
		expect((handleError.mock.calls[0][0] as Error).message).toBe(
			"rejected-yield",
		);
		// Yielded-promise rejections are policy decisions for the consumer; the
		// driver leaves epoch.done so the consumer can choose to continue or cancel.
		expect(epoch.done).toBe(false);
	});

	test("rejected step (async generator throw) marks epoch done and reports error", async () => {
		const handleError = vi.fn();
		const epoch = makeEpoch(async function* () {
			throw new Error("async-throw");
		});

		drive(epoch, epoch.generator.next(undefined), () => undefined, handleError);

		await flush();
		expect(epoch.done).toBe(true);
		expect(handleError).toHaveBeenCalledOnce();
		expect((handleError.mock.calls[0][0] as Error).message).toBe("async-throw");
	});

	test("late async resumption into a cancelled epoch is suppressed", async () => {
		const handleYield = vi.fn().mockReturnValue(undefined);
		const handleError = vi.fn();
		let resolveStep: (value: unknown) => void = () => {};
		const pending = new Promise((resolve) => {
			resolveStep = resolve;
		});

		const epoch = makeEpoch(function* () {
			yield pending;
			yield "after-await";
		});

		drive(epoch, epoch.generator.next(undefined), handleYield, handleError);

		cancel(epoch);
		resolveStep("late");
		await flush();

		expect(handleYield).not.toHaveBeenCalled();
		expect(handleError).not.toHaveBeenCalled();
	});
});

describe("throwInto", () => {
	test("returns false for an already-done epoch", () => {
		const epoch = makeEpoch(function* () {
			yield 1;
		});
		epoch.done = true;

		const handled = throwInto(
			epoch,
			new Error("nope"),
			() => undefined,
			() => {},
		);

		expect(handled).toBe(false);
	});

	test("delivers error to a generator that catches and continues", () => {
		const recovered: unknown[] = [];
		const epoch = makeEpoch(function* () {
			try {
				yield "before";
			} catch (error) {
				recovered.push((error as Error).message);
				yield "after-catch";
			}
		});

		// Park the generator at the first yield without running the loop —
		// drive() would synchronously walk to completion since handleYield
		// returns undefined.
		epoch.generator.next(undefined);

		const handled = throwInto(
			epoch,
			new Error("recover-me"),
			(_epoch, value) => {
				recovered.push(value);
				return undefined;
			},
			() => {},
		);

		expect(handled).toBe(true);
		expect(recovered).toEqual(["recover-me", "after-catch"]);
	});

	test("uncaught throw marks epoch done and reports through handleError", () => {
		const handleError = vi.fn();
		const epoch = makeEpoch(function* () {
			yield "parked";
		});

		epoch.generator.next(undefined);

		const handled = throwInto(
			epoch,
			new Error("uncaught"),
			() => undefined,
			handleError,
		);

		expect(handled).toBe(true);
		expect(epoch.done).toBe(true);
		expect(handleError).toHaveBeenCalledOnce();
		expect((handleError.mock.calls[0][0] as Error).message).toBe("uncaught");
	});

	test("recovery yield can complete with cleanup capture", () => {
		const cleanupSpy = vi.fn();
		const epoch = makeEpoch(function* () {
			try {
				yield "wait";
			} catch {
				return cleanupSpy;
			}
		});

		epoch.generator.next(undefined);

		throwInto(
			epoch,
			new Error("trigger-return"),
			() => undefined,
			() => {},
		);

		expect(epoch.done).toBe(true);
		expect(epoch.cleanup).toBe(cleanupSpy);
	});
});

describe("cancel", () => {
	test("invokes generator.return so user finally blocks fire", () => {
		const finallySpy = vi.fn();
		const epoch = makeEpoch(function* () {
			try {
				yield "parked";
				yield "never-reached";
			} finally {
				finallySpy();
			}
		});

		epoch.generator.next(undefined);
		expect(finallySpy).not.toHaveBeenCalled();

		cancel(epoch);

		expect(finallySpy).toHaveBeenCalledOnce();
		expect(epoch.done).toBe(true);
	});

	test("is idempotent", () => {
		const finallySpy = vi.fn();
		const epoch = makeEpoch(function* () {
			try {
				yield "parked";
				yield "never-reached";
			} finally {
				finallySpy();
			}
		});

		epoch.generator.next(undefined);

		cancel(epoch);
		cancel(epoch);
		cancel(epoch);

		expect(finallySpy).toHaveBeenCalledOnce();
	});

	test("swallows errors thrown by user finally blocks", () => {
		const epoch = makeEpoch(function* () {
			try {
				yield "parked";
				yield "never-reached";
			} finally {
				throw new Error("finally-boom");
			}
		});

		epoch.generator.next(undefined);

		expect(() => cancel(epoch)).not.toThrow();
		expect(epoch.done).toBe(true);
	});

	test("cancelling an async generator does not reject the un-awaited return promise", async () => {
		const epoch = makeEpoch(async function* () {
			yield "parked";
			yield "never-reached";
		});

		// Async generator: priming via .next() returns a promise. Resolve it so
		// the generator parks at "parked" before we cancel.
		await epoch.generator.next(undefined);

		expect(() => cancel(epoch)).not.toThrow();
		expect(epoch.done).toBe(true);
		await flush();
	});
});

// Reproduces the restart pattern used by index.ts#restartGenerator:
// cancel the current generator, swap epoch.generator for a fresh one,
// reset done=false, then drive the new generator on the SAME epoch object.
// The .then closures captured by drive() during the first run still hold
// the same epoch reference, so any late resolution from the cancelled
// generator can still re-enter drive(epoch, ...).
describe("epoch reuse across restart (regression for stale-resolution bug)", () => {
	test("late {done:true} from cancelled generator must not mark a freshly restarted epoch done", async () => {
		let resolveOldAwait: (() => void) | null = null;
		const oldAwait = new Promise<void>((resolve) => {
			resolveOldAwait = resolve;
		});

		const oldGenerator = async function* () {
			yield "old-first";
			await oldAwait;
			yield "old-second";
		};

		// Park gen at the await: drive yields "old-first", calls handleYield,
		// then enters the await on the next .next() and parks.
		const epoch = makeEpoch(oldGenerator);
		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			() => {},
		);
		await flush();

		// Restart pattern (mirrors index.ts#restartGenerator).
		cancel(epoch);
		const newYields: unknown[] = [];
		const newGenerator = async function* () {
			yield "new-first";
			await new Promise<void>((resolve) => setTimeout(resolve, 30));
			yield "new-second";
		};
		epoch.generator = newGenerator();
		epoch.cleanup = null;
		epoch.done = false;

		drive(
			epoch,
			epoch.generator.next(undefined),
			(_epoch, value) => {
				newYields.push(value);
				return undefined;
			},
			() => {},
		);
		await flush();
		expect(newYields).toEqual(["new-first"]);

		// Resolve the cancelled generator's await. Its queued return resolves
		// the .next() promise drive was waiting on with {done: true, value: undefined}.
		// The captured .then closure calls drive(epoch, ...) on the SAME epoch —
		// which is now driving the new generator parked at its own await.
		resolveOldAwait?.();
		await new Promise((resolve) => setTimeout(resolve, 50));

		// If the bug is present, captureCleanup runs with the stale step,
		// epoch.done flips to true, and "new-second" never reaches handleYield.
		expect(newYields).toEqual(["new-first", "new-second"]);
	});

	test("late {done:false, value} from cancelled generator must not flow into the restarted generator", async () => {
		// Edge case: the cancelled generator yielded a non-Promise value before
		// the cancel landed, but the .next() Promise hadn't resolved yet. When
		// it does resolve, drive sees a yielded value and routes it through
		// handleYield AND advances the epoch's now-replaced generator.
		let resolveOldStep: ((step: IteratorResult<unknown>) => void) | null = null;
		const queuedStep = new Promise<IteratorResult<unknown>>((resolve) => {
			resolveOldStep = resolve;
		});

		// Hand-rolled generator-like object so we can control exactly what its
		// .next() returns. drive() only calls .next/.return/.throw, so this is
		// sufficient for the test.
		const oldGenerator = {
			next: () => queuedStep,
			return: () => Promise.resolve({ done: true, value: undefined }),
			throw: (error: unknown) => Promise.reject(error),
			[Symbol.asyncIterator]() {
				return this;
			},
		} as unknown as AsyncGenerator;

		const epoch: GeneratorEpoch = {
			type: EPOCH_TYPE.GENERATOR,
			generatorFn: (() => oldGenerator) as unknown as GeneratorFn,
			generator: oldGenerator,
			cleanup: null,
			done: false,
		};

		const handleYield = vi.fn().mockReturnValue(undefined);

		drive(epoch, epoch.generator.next(undefined), handleYield, () => {});
		// Park: queuedStep is unresolved.

		// Restart pattern.
		cancel(epoch);
		const newYields: unknown[] = [];
		epoch.generator = (async function* () {
			yield "new-first";
			yield "new-second";
		})();
		epoch.cleanup = null;
		epoch.done = false;

		drive(
			epoch,
			epoch.generator.next(undefined),
			(_epoch, value) => {
				newYields.push(value);
				return undefined;
			},
			() => {},
		);
		await flush();
		await flush();

		// Now resolve the queued step from the cancelled generator with a value
		// that LOOKS like a valid yield. With the bug, drive() sees epoch.done=false,
		// runs handleYield(epoch, "stale-value") on the new run's handler, then
		// calls epoch.generator.next(...) — advancing the NEW generator with the
		// echoed result. The new run is corrupted.
		resolveOldStep?.({ done: false, value: "stale-value" });
		await flush();
		await flush();

		expect(newYields).not.toContain("stale-value");
	});
});

// The cleanup contract today: epoch.cleanup is only set by captureCleanup,
// which runs when drive() observes step.done. cancel() invokes
// generator.return() but does not feed the result back through drive, so
// any `return cleanupFn` line the user wrote is unreachable when cancel
// fires before natural completion. These tests pin that behavior so any
// future change to cleanup-on-cancel is a deliberate decision, not a drift.
describe("cleanup capture vs cancel — current contract", () => {
	test("cleanup function from `return cleanupFn` is NOT captured when cancelled mid-await", async () => {
		const cleanupSpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		const epoch = makeEpoch(async function* () {
			yield "parked";
			await new Promise<void>((resolve) => {
				resolveAwait = resolve;
			});
			return cleanupSpy;
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			() => {},
		);
		await flush();

		cancel(epoch);

		// Even after the awaited promise settles, the queued .return() drains
		// past the explicit `return cleanupSpy` line — the body never reaches it.
		resolveAwait?.();
		await flush();
		await flush();

		expect(epoch.cleanup).toBeNull();
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("cleanup function IS captured when the generator completes naturally before cancel", () => {
		const cleanupSpy = vi.fn();
		const epoch = makeEpoch(function* () {
			yield "first";
			return cleanupSpy;
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			() => {},
		);

		expect(epoch.cleanup).toBe(cleanupSpy);

		// Cancel after natural completion is a no-op for cleanup state.
		cancel(epoch);
		expect(epoch.cleanup).toBe(cleanupSpy);
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("try/finally is the only path that fires cancellation cleanup mid-await", async () => {
		const finallySpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		const epoch = makeEpoch(async function* () {
			yield "parked";
			try {
				await new Promise<void>((resolve) => {
					resolveAwait = resolve;
				});
			} finally {
				finallySpy();
			}
		});

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			() => {},
		);
		await flush();

		cancel(epoch);
		// Disconnect alone cannot unblock the pending await — finally has not
		// run yet. Documents the same constraint as the integration suite.
		expect(finallySpy).not.toHaveBeenCalled();

		resolveAwait?.();
		await flush();
		await flush();
		expect(finallySpy).toHaveBeenCalledTimes(1);
	});
});
