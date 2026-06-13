import { describe, expect, test, vi } from "vitest";
import { Task, cancelTask, createTask, driveTask, throwIntoTask } from "./task";

/*
isolated tests for the Task<R> primitive — no DOM, no runtime. a "runtime" here is just a
recorder the toy hooks write to, which is the whole point of the split: the generator-lifetime
machinery is testable on its own. each test supplies a tiny generator and asserts on the order
and once-ness of onYield / onError / onSettle, plus cleanup capture and late-await containment.
*/

interface Recorder {
	yields: unknown[];
	errors: Error[];
	settles: number;
}

const recorder = (): Recorder => ({ yields: [], errors: [], settles: 0 });

//a generator parks the synchronous driver only when it suspends on a real Promise — a sync
//generator with no Promise runs to completion inside driveTask. deferred() gives us that Promise
const deferred = () => {
	let resolve!: (value?: unknown) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise((res, rej) => {
		resolve = res as (value?: unknown) => void;
		reject = rej;
	});
	return { promise, resolve, reject };
};

//async-generator hops are multiple microtasks; a macrotask turn drains them deterministically
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const HOST = Symbol("host");

interface SpawnHooks {
	parent: Task<Recorder> | null;
	onYield: (task: Task<Recorder>, value: unknown) => unknown;
	onError: (task: Task<Recorder>, error: Error) => void;
	onSettle: ((task: Task<Recorder>) => void) | null;
}

//build + return a task and its recorder. defaults: onYield records and hands back HOST (the real
//CSR handler returns the host so the generator's `yield` expression evaluates to it), onError
//records, onSettle counts. each test overrides only what it cares about
const spawn = (generator: Generator | AsyncGenerator, hooks: Partial<SpawnHooks> = {}) => {
	const rec = recorder();
	const task = createTask<Recorder>(
		rec,
		generator,
		hooks.parent ?? null,
		hooks.onYield ??
			((_task, value) => {
				rec.yields.push(value);
				return HOST;
			}),
		hooks.onError ??
			((_task, error) => {
				rec.errors.push(error);
			}),
		hooks.onSettle === undefined ? () => rec.settles++ : hooks.onSettle,
	);
	return { task, rec };
};

describe("driving (A1/A4)", () => {
	test("a sync generator runs to completion inside driveTask and settles once", () => {
		function* gen() {
			yield "a";
			yield "b";
		}
		const { task, rec } = spawn(gen());
		driveTask(task);

		expect(rec.yields).toEqual(["a", "b"]);
		expect(rec.settles).toBe(1);
		expect(task.finished).toBe(true);
	});

	test("onYield's return is fed back as the yield expression's value", () => {
		let fedBack: unknown;
		function* gen() {
			fedBack = yield "a";
		}
		const { task } = spawn(gen());
		driveTask(task);

		expect(fedBack).toBe(HOST);
	});

	test("a sync generator that yields a Promise unwraps it before onYield (A4)", async () => {
		let fedBack: unknown;
		function* gen() {
			fedBack = yield Promise.resolve(7);
		}
		const { task, rec } = spawn(gen(), {
			onYield: (_task, value) => {
				rec.yields.push(value);
				return value;
			},
		});
		driveTask(task);
		expect(rec.yields).toEqual([]); //parked on the Promise — onYield hasn't run yet

		await tick();
		expect(rec.yields).toEqual([7]); //resolved value, not the Promise
		expect(fedBack).toBe(7);
		expect(rec.settles).toBe(1);
	});

	test("a sync error routed through onError during the first step reads the right task", () => {
		//create-before-drive: the hook reads the task off its PARAMETER, so an error that surfaces
		//synchronously while driving the first step (here: onYield throws) sees the live task rather
		//than a runtime slot that may not be assigned yet — the bug the old context-threaded handle had
		function* gen() {
			yield "trigger";
			yield "after";
		}
		let erroredTask: Task<Recorder> | null = null;
		const { task, rec } = spawn(gen(), {
			onYield: () => {
				throw new Error("handling the first yield threw");
			},
			onError: (t, error) => {
				erroredTask = t;
				rec.errors.push(error);
			},
		});
		driveTask(task);

		expect(erroredTask).toBe(task);
		expect(rec.errors).toHaveLength(1);
		expect(rec.settles).toBe(1);
		expect(task.finished).toBe(true);
	});

	test("a throw before the first yield escapes the driver to the caller boundary", () => {
		//matches producer.ts beginHandle: the driver does generator.next() up front, so a throw that
		//happens before any yield isn't routed through onError — it propagates to the public entry
		//point (connectedCallback), which is the boundary that owns first-step failures (CONVENTIONS #7)
		function* gen(): Generator {
			throw new Error("boom before any yield");
			yield "never";
		}
		const { task, rec } = spawn(gen());

		expect(() => driveTask(task)).toThrow("boom before any yield");
		expect(rec.errors).toEqual([]); //not routed through onError
		expect(rec.settles).toBe(0);
	});
});

describe("completion & cleanup (D1/D2)", () => {
	test("`return cleanupFn` is captured on completion but not fired until cancel (D2)", () => {
		const cleanup = vi.fn();
		function* gen() {
			yield "a";
			return cleanup;
		}
		const { task, rec } = spawn(gen());
		driveTask(task);

		expect(task.cleanup).toBe(cleanup);
		expect(cleanup).not.toHaveBeenCalled(); //captured, deferred
		expect(rec.settles).toBe(1); //completion still settles

		cancelTask(task);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	test("cancel runs the generator's finally even while parked mid-flight (D1)", () => {
		const gate = deferred();
		let finallyRan = false;
		function* gen() {
			try {
				yield "a";
				yield gate.promise; //parks the driver here
				yield "unreached";
			} finally {
				finallyRan = true;
			}
		}
		const { task, rec } = spawn(gen());
		driveTask(task);
		expect(rec.yields).toEqual(["a"]); //parked on the gate

		cancelTask(task);
		expect(finallyRan).toBe(true);
		expect(task.finished).toBe(true);
		expect(task.cleanup).toBeNull(); //no `return cleanupFn` reached — nothing to capture on cancel
		expect(rec.settles).toBe(0); //cancellation is supersession, it does not settle
	});

	test("cancel is idempotent: finally and cleanup fire exactly once (D4)", () => {
		const cleanup = vi.fn();
		let finallyCount = 0;
		function* gen() {
			try {
				yield "a";
				return cleanup;
			} finally {
				finallyCount++;
			}
		}
		const { task } = spawn(gen());
		driveTask(task); //natural completion: finally runs here, cleanup captured

		cancelTask(task);
		cancelTask(task);
		cancelTask(task);
		expect(finallyCount).toBe(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	test("cancelTask swallows a throw from the generator's finally so teardown continues", () => {
		const gate = deferred();
		function* gen() {
			try {
				yield gate.promise; //parks here; cancel's .return() triggers the finally
			} finally {
				throw new Error("finally threw");
			}
		}
		const { task } = spawn(gen());
		driveTask(task); //parked

		//cancel calls generator.return(), which runs the throwing finally; the swallow keeps it from
		//escaping cancelTask so the rest of a teardown sequence still runs
		expect(() => cancelTask(task)).not.toThrow();
		expect(task.finished).toBe(true);
	});
});

describe("cancellation containment (D3)", () => {
	test("a cancelled async task's late await goes nowhere", async () => {
		const gate = deferred();
		async function* gen() {
			yield "a";
			await gate.promise;
			yield "b"; //must never reach onYield after cancel
		}
		const { task, rec } = spawn(gen());
		driveTask(task);
		await tick();
		expect(rec.yields).toEqual(["a"]); //parked inside the await

		cancelTask(task);
		gate.resolve();
		await tick();

		expect(rec.yields).toEqual(["a"]); //"b" contained
		expect(rec.settles).toBe(0);
	});

	test("a sync task parked on a yielded Promise is contained after cancel", async () => {
		const gate = deferred();
		function* gen() {
			yield "a";
			yield gate.promise;
			yield "b";
		}
		const { task, rec } = spawn(gen());
		driveTask(task);
		expect(rec.yields).toEqual(["a"]);

		cancelTask(task);
		gate.resolve("resumed");
		await tick();

		expect(rec.yields).toEqual(["a"]); //resolution of the parked Promise is dropped
	});
});

describe("errors (E1 mechanics)", () => {
	test("an onYield throw terminates the task and doesn't step it further", () => {
		function* gen() {
			yield "boom";
			yield "after";
		}
		const { task, rec } = spawn(gen(), {
			onYield: (_task, value) => {
				if (value === "boom") throw new Error("onYield rejected the value");
				rec.yields.push(value);
				return HOST;
			},
		});
		driveTask(task);

		expect(rec.errors).toHaveLength(1);
		expect(rec.yields).toEqual([]); //"after" never reached
		expect(rec.settles).toBe(1);
		expect(task.finished).toBe(true);
	});

	test("throwIntoTask resumes a generator that catches and recovers", () => {
		const gate = deferred();
		function* gen() {
			try {
				yield gate.promise; //parked here when the error is injected
			} catch {
				yield "recovered";
			}
		}
		const { task, rec } = spawn(gen());
		driveTask(task);

		throwIntoTask(task, new Error("injected"));
		expect(rec.yields).toEqual(["recovered"]);
		expect(rec.errors).toEqual([]); //caught, so onError never fires
		expect(rec.settles).toBe(1);
	});

	test("throwIntoTask whose throw escapes finishes the task and reports once", () => {
		const gate = deferred();
		function* gen() {
			yield gate.promise; //no try/catch — the injected error escapes
		}
		const { task, rec } = spawn(gen());
		driveTask(task);

		throwIntoTask(task, new Error("escapes"));
		expect(rec.errors).toHaveLength(1);
		expect(rec.settles).toBe(1);
		expect(task.finished).toBe(true);
	});

	test("throwIntoTask on a finished task is a no-op", () => {
		function* gen() {
			yield "a";
		}
		const { task, rec } = spawn(gen());
		driveTask(task); //completes
		const settlesAfterCompletion = rec.settles;

		throwIntoTask(task, new Error("too late"));
		expect(rec.errors).toEqual([]);
		expect(rec.settles).toBe(settlesAfterCompletion);
	});

	test("a rejected await terminates the task through the error path", async () => {
		async function* gen() {
			yield "a";
			await Promise.reject(new Error("await rejected"));
			yield "b";
		}
		const { task, rec } = spawn(gen());
		driveTask(task);
		await tick();

		expect(rec.errors).toHaveLength(1);
		expect(rec.yields).toEqual(["a"]); //"b" never reached
		expect(rec.settles).toBe(1);
		expect(task.finished).toBe(true);
	});
});

describe("depth marker (parent)", () => {
	test("a root has null parent; a child points at the root", () => {
		function* root() {
			yield "root";
		}
		function* child() {
			yield "child";
		}
		const { task: rootTask } = spawn(root());
		const childTask = createTask<Recorder>(
			rootTask.runtime,
			child(),
			rootTask, //depth-1 child's parent is the root
			rootTask.onYield,
			rootTask.onError,
			null,
		);

		expect(rootTask.parent).toBeNull();
		expect(childTask.parent).toBe(rootTask);
	});
});
