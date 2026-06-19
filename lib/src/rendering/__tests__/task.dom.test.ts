import { describe, expect, test } from "vitest";
import { html } from "../../parser/html";
import { HTMLTemplate } from "../template-html";
import {
	COMMAND,
	EVENT,
	ROLE,
	StepEvent,
	step,
	Task,
	TASK_STATE,
} from "../task";

/*
the reducer's synchronous core in isolation: step(task, incomingEvent) -> Command, driven purely by
task.state. these pin the dispatch, the role split (outer installs / inner hits the depth limit, outer
fails / inner bubbles), and the cleanup capture — all without a DOM, a timer, or a coroutine. supersession
is not the reducer's job (it lives in the shell's slot identity), so it is not tested here. the async
orchestration (drive, the flush, SSR) is exercised end-to-end by
tests/integration. depth-2 is a recursion in the shell, not a state here, so there is no inner-nesting
machine to test: the inner simply yields a generator function and the table routes it to the parent.
*/

const template = (): HTMLTemplate => html`<p>x</p>` as unknown as HTMLTemplate;

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	generator: (function* () {})(),
	role: ROLE.OUTER,
	state: TASK_STATE.DRIVING,
	cleanup: null,
	...overrides,
});

const yielded = (payload: unknown): StepEvent => ({
	kind: EVENT.YIELDED,
	payload,
});

describe("step: dispatch while driving", () => {
	test("a template paints", () => {
		const value = template();
		const command = step(makeTask(), yielded(value));
		expect(command.kind).toBe(COMMAND.PAINT);
		expect(command.payload).toBe(value);
	});

	test("a render function paints from it", () => {
		const renderFunction = () => template();
		const command = step(makeTask(), yielded(renderFunction));
		expect(command.kind).toBe(COMMAND.PAINT_FROM);
		expect(command.payload).toBe(renderFunction);
	});

	test("an outer generator function installs an inner", () => {
		const generator = function* () {};
		const command = step(makeTask({ role: ROLE.OUTER }), yielded(generator));
		expect(command.kind).toBe(COMMAND.INSTALL);
		expect(command.payload).toBe(generator);
	});

	test("an inner generator function is the one depth-limit error — it bubbles to the parent", () => {
		const task = makeTask({ role: ROLE.INNER });
		const command = step(
			task,
			yielded(function* () {}),
		);
		expect(command.kind).toBe(COMMAND.THROW_TO_PARENT);
		expect(String((command as { payload: unknown }).payload)).toContain(
			"Inner generators cannot yield generator functions",
		);
		expect(task.state).toBe(TASK_STATE.FAILED);
	});

	test("a yielded promise suspends and AWAITs", () => {
		const task = makeTask();
		const promise = Promise.resolve("x");
		const command = step(task, yielded(promise));
		expect(command.kind).toBe(COMMAND.AWAIT);
		expect(command.payload).toBe(promise);
		expect(task.state).toBe(TASK_STATE.SUSPENDED);
	});

	test("a plain value resumes the coroutine", () => {
		const command = step(makeTask(), yielded(42));
		expect(command.kind).toBe(COMMAND.RESUME);
		expect(command.payload).toBe(42);
	});
});

describe("step: completion and cleanup", () => {
	test("a function return is captured as cleanup; the task is done", () => {
		const cleanup = () => {};
		const task = makeTask();
		const command = step(task, { kind: EVENT.RETURNED, payload: cleanup });
		expect(command.kind).toBe(COMMAND.COMPLETED);
		expect(task.cleanup).toBe(cleanup);
		expect(task.state).toBe(TASK_STATE.DONE);
	});

	test("a non-function return captures no cleanup", () => {
		const task = makeTask();
		step(task, { kind: EVENT.RETURNED, payload: undefined });
		expect(task.cleanup).toBe(null);
	});
});

describe("step: error routing by role", () => {
	test("an inner throw bubbles to the parent", () => {
		const task = makeTask({ role: ROLE.INNER });
		const error = new Error("inner-failed");
		const command = step(task, { kind: EVENT.THREW, payload: error });
		expect(command.kind).toBe(COMMAND.THROW_TO_PARENT);
		expect(command.payload).toBe(error);
		expect(task.state).toBe(TASK_STATE.FAILED);
	});

	test("an outer throw is terminal", () => {
		const task = makeTask({ role: ROLE.OUTER });
		const command = step(
			task,
			{ kind: EVENT.THREW, payload: new Error("boom") },
		);
		expect(command.kind).toBe(COMMAND.FAIL);
		expect(task.state).toBe(TASK_STATE.FAILED);
	});
});

describe("step: suspended resume", () => {
	test("a settled promise resumes the suspended coroutine", () => {
		const task = makeTask({ state: TASK_STATE.SUSPENDED, role: ROLE.INNER });
		const command = step(task, { kind: EVENT.RESUMED, payload: "resolved" });
		expect(command.kind).toBe(COMMAND.RESUME);
		expect(command.payload).toBe("resolved");
		expect(task.state).toBe(TASK_STATE.DRIVING);
	});

	test("a rejected await routes by role", () => {
		const inner = makeTask({ state: TASK_STATE.SUSPENDED, role: ROLE.INNER });
		expect(step(inner, { kind: EVENT.THREW, payload: 1 }).kind).toBe(
			COMMAND.THROW_TO_PARENT,
		);
		const outer = makeTask({ state: TASK_STATE.SUSPENDED, role: ROLE.OUTER });
		expect(step(outer, { kind: EVENT.THREW, payload: 1 }).kind).toBe(
			COMMAND.FAIL,
		);
	});
});

describe("step: the reused command cell", () => {
	test("every step returns the same backing cell — write-once-read-once, zero per-yield allocation", () => {
		const task = makeTask();
		const first = step(task, yielded(1));
		const second = step(task, yielded(2));
		expect(second).toBe(first); //same object: the shell consumes each command before the next step
		expect(first.payload).toBe(2);
	});
});
