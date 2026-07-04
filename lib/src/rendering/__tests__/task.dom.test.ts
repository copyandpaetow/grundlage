import { describe, expect, test } from "vitest";
import { html, TemplateValue } from "../../template-value";
import {
	nextOperation as step,
	OPERATION,
	ROLE,
	STEP_OUTCOME,
	StepOutcome,
	Task,
	TASK_STATE,
} from "../task";

/*
the reducer's synchronous core in isolation: step(task, incomingOutcome) -> Operation, driven purely by
task.state. these pin the dispatch, the role split (outer installs / inner hits the depth limit, outer
fails / inner bubbles), and the cleanup capture — all without a DOM, a timer, or a coroutine. supersession
is not the reducer's job (it lives in the shell's slot identity), so it is not tested here. the async
orchestration (drive, the flush, SSR) is exercised end-to-end by
tests/integration. depth-2 is a recursion in the shell, not a state here, so there is no inner-nesting
machine to test: the inner simply yields a generator function and the table routes it to the parent.
*/

const template = (): TemplateValue => html`<p>x</p>`;

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	generator: (function* () {})(),
	role: ROLE.OUTER,
	state: TASK_STATE.DRIVING,
	cleanup: null,
	...overrides,
});

const yielded = (payload: unknown): StepOutcome => ({
	kind: STEP_OUTCOME.YIELDED,
	payload,
});

describe("step: dispatch while driving", () => {
	test("a template paints", () => {
		const value = template();
		const operation = step(makeTask(), yielded(value));
		expect(operation.kind).toBe(OPERATION.PAINT);
		expect(operation.payload).toBe(value);
	});

	test("a render function paints from it", () => {
		const renderFunction = () => template();
		const operation = step(makeTask(), yielded(renderFunction));
		expect(operation.kind).toBe(OPERATION.PAINT_FROM);
		expect(operation.payload).toBe(renderFunction);
	});

	test("an outer generator function installs an inner", () => {
		const generator = function* () {};
		const operation = step(makeTask({ role: ROLE.OUTER }), yielded(generator));
		expect(operation.kind).toBe(OPERATION.INSTALL);
		expect(operation.payload).toBe(generator);
	});

	test("an inner generator function is the one depth-limit error — it bubbles to the parent", () => {
		const task = makeTask({ role: ROLE.INNER });
		const operation = step(
			task,
			yielded(function* () {}),
		);
		expect(operation.kind).toBe(OPERATION.THROW_TO_PARENT);
		expect(String((operation as { payload: unknown }).payload)).toContain(
			"Inner generators cannot yield generator functions",
		);
		expect(task.state).toBe(TASK_STATE.FAILED);
	});

	test("a yielded promise suspends and AWAITs", () => {
		const task = makeTask();
		const promise = Promise.resolve("x");
		const operation = step(task, yielded(promise));
		expect(operation.kind).toBe(OPERATION.AWAIT);
		expect(operation.payload).toBe(promise);
		expect(task.state).toBe(TASK_STATE.SUSPENDED);
	});

	test("a plain value resumes the coroutine", () => {
		const operation = step(makeTask(), yielded(42));
		expect(operation.kind).toBe(OPERATION.RESUME);
		expect(operation.payload).toBe(42);
	});
});

describe("step: completion and cleanup", () => {
	test("a function return is captured as cleanup; the task is done", () => {
		const cleanup = () => {};
		const task = makeTask();
		const operation = step(task, {
			kind: STEP_OUTCOME.RETURNED,
			payload: cleanup,
		});
		expect(operation.kind).toBe(OPERATION.COMPLETED);
		expect(task.cleanup).toBe(cleanup);
		expect(task.state).toBe(TASK_STATE.DONE);
	});

	test("a non-function return captures no cleanup", () => {
		const task = makeTask();
		step(task, { kind: STEP_OUTCOME.RETURNED, payload: undefined });
		expect(task.cleanup).toBe(null);
	});
});

describe("step: error routing by role", () => {
	test("an inner throw bubbles to the parent", () => {
		const task = makeTask({ role: ROLE.INNER });
		const error = new Error("inner-failed");
		const operation = step(task, { kind: STEP_OUTCOME.THREW, payload: error });
		expect(operation.kind).toBe(OPERATION.THROW_TO_PARENT);
		expect(operation.payload).toBe(error);
		expect(task.state).toBe(TASK_STATE.FAILED);
	});

	test("an outer throw is terminal", () => {
		const task = makeTask({ role: ROLE.OUTER });
		const operation = step(task, {
			kind: STEP_OUTCOME.THREW,
			payload: new Error("boom"),
		});
		expect(operation.kind).toBe(OPERATION.FAIL);
		expect(task.state).toBe(TASK_STATE.FAILED);
	});
});

describe("step: suspended resume", () => {
	test("a settled promise resumes the suspended coroutine", () => {
		const task = makeTask({ state: TASK_STATE.SUSPENDED, role: ROLE.INNER });
		const operation = step(task, {
			kind: STEP_OUTCOME.RESUMED,
			payload: "resolved",
		});
		expect(operation.kind).toBe(OPERATION.RESUME);
		expect(operation.payload).toBe("resolved");
		expect(task.state).toBe(TASK_STATE.DRIVING);
	});

	test("a rejected await routes by role", () => {
		const inner = makeTask({ state: TASK_STATE.SUSPENDED, role: ROLE.INNER });
		expect(step(inner, { kind: STEP_OUTCOME.THREW, payload: 1 }).kind).toBe(
			OPERATION.THROW_TO_PARENT,
		);
		const outer = makeTask({ state: TASK_STATE.SUSPENDED, role: ROLE.OUTER });
		expect(step(outer, { kind: STEP_OUTCOME.THREW, payload: 1 }).kind).toBe(
			OPERATION.FAIL,
		);
	});
});

describe("step: the reused operation cell", () => {
	test("every step returns the same backing cell — write-once-read-once, zero per-yield allocation", () => {
		const task = makeTask();
		const first = step(task, yielded(1));
		const second = step(task, yielded(2));
		expect(second).toBe(first); //same object: the shell consumes each operation before the next step
		expect(first.payload).toBe(2);
	});
});
