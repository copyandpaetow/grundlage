import { describe, expect, test, vi } from "vitest";
import {
	cancel,
	drive,
	EPOCH_TYPE,
	GeneratorEpoch,
	throwInto,
} from "./generator-driver";
import { GeneratorFn } from "../types";

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

		drive(
			epoch,
			epoch.generator.next(undefined),
			handleYield,
			() => {},
		);

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

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			handleError,
		);

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

		drive(
			epoch,
			epoch.generator.next(undefined),
			handleYieldSpy,
			() => {},
		);

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

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			handleError,
		);

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

		drive(
			epoch,
			epoch.generator.next(undefined),
			() => undefined,
			handleError,
		);

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

		drive(
			epoch,
			epoch.generator.next(undefined),
			handleYield,
			handleError,
		);

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
