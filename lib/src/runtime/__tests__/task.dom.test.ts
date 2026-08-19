import { afterEach, describe, expect, test, vi } from "vitest";
import { html, TemplateValue } from "../../template";
import {
	classifyRenderResultAsOperation as classifyRenderResult,
	cancelTaskAndRunCleanup,
	classifySettledStepAsOperation as classifyStep,
	DriverStep,
	endTaskWithError,
	isParkedAtARenderableYield,
	MODE,
	OPERATION,
	stepTaskToNextOperation,
	Task,
} from "../task";

//the two classifiers in isolation, with no DOM, no timer and no coroutine. classifyStep says what a
//generator did; classifyRenderResult says what a render function returned. Both speak one currency,
//an operation, and there is no intermediate outcome object, so a throw is routed the moment it
//happens rather than re-entering a classifier wearing a yield's clothes. The classifiers never call
//a render function or step anything: the driver does that, and tests/integration covers it
//end-to-end. A task knows nothing about the element it renders into, so which task may install a
//branch and where an error goes are driver questions, covered there too.

afterEach(() => {
	vi.restoreAllMocks();
});

const template = (): TemplateValue => html`<p>x</p>`;

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	generator: (function* () {})(),
	suspension: null,
	cleanup: null,
	...overrides,
});

const parkedAtARenderable = (): Partial<Task> => ({
	suspension: { isAtARenderableYield: true },
});

const yielded = (value: unknown): IteratorResult<unknown> => ({
	done: false,
	value,
});

const returned = (value: unknown): IteratorResult<unknown> => ({
	done: true,
	value,
});

const messageOf = (operation: { payload: unknown }): string =>
	String(operation.payload);

describe("classifyStep: what the generator yielded", () => {
	test("a template paints", () => {
		const value = template();
		const operation = classifyStep(makeTask(), yielded(value));
		expect(operation.kind).toBe(OPERATION.PAINT_FROM_YIELD);
		expect(operation.payload).toBe(value);
	});

	//the classifier hands the function to the render lane rather than calling it, which is what
	//keeps a refire out of this switch
	test("a render function is handed over, not called", () => {
		let calls = 0;
		const renderFunction = () => {
			calls++;
			return template();
		};
		const operation = classifyStep(makeTask(), yielded(renderFunction));
		expect(operation.kind).toBe(OPERATION.CALL_RENDER_FUNCTION);
		expect(operation.payload).toBe(renderFunction);
		expect(calls).toBe(0);
	});

	//the two install kinds differ only in which of them makes the generator the refire target, so
	//the driver's one arm can tell a yielded body from a returned one
	test("a generator function is handed over as an install from a yield", () => {
		const generator = function* () {};
		const operation = classifyStep(makeTask(), yielded(generator));
		expect(operation.kind).toBe(OPERATION.INSTALL_FROM_YIELD);
		expect(operation.payload).toBe(generator);
	});

	test("a yielded promise parks the task and defers a resume", async () => {
		const task = makeTask();
		const operation = classifyStep(task, yielded(Promise.resolve("x")));
		expect(operation.kind).toBe(OPERATION.DEFERRED);
		//a paint must not step it from here; only the promise settling may
		expect(task.suspension).not.toBe(null);
		expect(isParkedAtARenderableYield(task)).toBe(false);

		const settled = await (operation.payload as Promise<DriverStep>);
		expect(settled.kind).toBe(OPERATION.RESUME);
		expect(settled.payload).toBe("x");
	});

	test("a yielded promise whose permit is revoked releases control instead", async () => {
		const task = makeTask();
		const operation = classifyStep(task, yielded(Promise.resolve("x")));
		task.suspension = null;

		const settled = await (operation.payload as Promise<DriverStep>);
		expect(settled.kind).toBe(OPERATION.RELEASE_CONTROL);
	});

	test("a rejected yielded promise defers a throw into the generator", async () => {
		const task = makeTask();
		const failure = new Error("nope");
		const operation = classifyStep(task, yielded(Promise.reject(failure)));

		const settled = await (operation.payload as Promise<DriverStep>);
		expect(settled.kind).toBe(OPERATION.RESUME_WITH_ERROR);
		expect(settled.payload).toBe(failure);
	});

	test("a plain value resumes the coroutine", () => {
		const operation = classifyStep(makeTask(), yielded(42));
		expect(operation.kind).toBe(OPERATION.RESUME);
		expect(operation.payload).toBe(42);
	});

	test("a yielded array is echoed back, not painted", () => {
		const rows = [template(), template()];
		const operation = classifyStep(makeTask(), yielded(rows));
		expect(operation.kind).toBe(OPERATION.RESUME);
		expect(operation.payload).toBe(rows);
	});
});

describe("classifyRenderResult: the render function's return is content", () => {
	test("a string paints as-is — the driver coerces, the classifier does not", () => {
		const operation = classifyRenderResult(makeTask(), "hello");
		expect(operation.kind).toBe(OPERATION.PAINT_FROM_RENDER_RESULT);
		expect(operation.payload).toBe("hello");
	});

	test("an array paints as-is", () => {
		const rows = [template(), template()];
		const operation = classifyRenderResult(makeTask(), rows);
		expect(operation.kind).toBe(OPERATION.PAINT_FROM_RENDER_RESULT);
		expect(operation.payload).toBe(rows);
	});

	test("undefined paints nothing and warns once about the missing return", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const operation = classifyRenderResult(makeTask(), undefined);
		expect(operation.kind).toBe(OPERATION.PAINT_FROM_RENDER_RESULT);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain("undefined");
		warn.mockRestore();
	});

	test.each([
		["a plain object", { a: 1 }],
		["a Map", new Map()],
		["a plain function", () => {}],
		["a symbol", Symbol("x")],
		["a Date", new Date()],
	] as const)(
		"%s cannot be committed, so the task fails",
		(_label, produced) => {
			const task = makeTask(parkedAtARenderable());
			const operation = classifyRenderResult(task, produced);
			expect(operation.kind).toBe(OPERATION.ROUTE_ERROR);
			expect(messageOf(operation)).toContain("grundlage");
			expect(task.suspension).toBe(null);
		},
	);

	test("a generator function installs it, tagged as a render result", () => {
		const body = function* () {};
		const operation = classifyRenderResult(makeTask(), body);
		expect(operation.kind).toBe(OPERATION.INSTALL_FROM_RENDER_RESULT);
		expect(operation.payload).toBe(body);
	});

	test("a promise awaits the render result without ending the task", () => {
		const task = makeTask(parkedAtARenderable());
		const parkBeforeTheAwait = task.suspension;
		const promise = Promise.resolve("later");
		const operation = classifyRenderResult(task, promise);
		expect(operation.kind).toBe(OPERATION.AWAIT_RENDER_RESULT);
		expect(operation.payload).toBe(promise);
		//the same permit, so the settlement may still resume the yield that started the render
		expect(task.suspension).toBe(parkBeforeTheAwait);
	});

	test("a resolved result on a finished task paints and leaves it finished", () => {
		const task = makeTask();
		const operation = classifyRenderResult(task, "late");
		expect(operation.kind).toBe(OPERATION.PAINT_FROM_RENDER_RESULT);
		expect(task.suspension).toBe(null);
	});
});

describe("completion and cleanup", () => {
	test("a function return is captured as cleanup; the task is done", () => {
		const cleanup = () => {};
		const task = makeTask();
		const operation = classifyStep(task, returned(cleanup));
		expect(operation.kind).toBe(OPERATION.COMPLETED);
		expect(task.cleanup).toBe(cleanup);
	});

	//the step clears the park before it resumes the generator, so a completed task holds no permit
	test("a completing step leaves the task parked nowhere", () => {
		const task = makeTask({
			...parkedAtARenderable(),
			generator: (function* () {})(),
		});
		expect(stepTaskToNextOperation(task, MODE.SEND, undefined)).toMatchObject({
			kind: OPERATION.COMPLETED,
		});
		expect(task.suspension).toBe(null);
	});

	test("a non-function return captures no cleanup", () => {
		const task = makeTask();
		classifyStep(task, returned(undefined));
		expect(task.cleanup).toBe(null);
	});

	//the cancel has a sibling task to tear down and a paint to make after this, so a user cleanup
	//that throws is warned about rather than propagated
	test("a cleanup that throws does not escape the cancel", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const task = makeTask({
			cleanup: () => {
				throw new Error("cleanup-threw");
			},
		});

		expect(() => cancelTaskAndRunCleanup(task)).not.toThrow();
		expect(task.cleanup).toBe(null);
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe("ending a task with an error", () => {
	//a rejected render promise reaches this same exit rather than a step in THROW mode, which is
	//what keeps it out of the generator's try/catch; the lane enforces that structurally. one kind
	//for both destinations: which one an error reaches is the driver's call, not this module's
	test("the error is carried out as one kind and the park is cleared", () => {
		const task = makeTask(parkedAtARenderable());
		const error = new Error("boom");
		const operation = endTaskWithError(task, error);
		expect(operation.kind).toBe(OPERATION.ROUTE_ERROR);
		expect(operation.payload).toBe(error);
		//one field, so routing cannot leave half a park behind
		expect(task.suspension).toBe(null);
	});

	//the step routes its own throw, so no synthesized outcome carries it back to a classifier
	test("a generator that throws when stepped routes the error itself", () => {
		const error = new Error("inner-failed");
		const task = makeTask({
			generator: (function* () {
				throw error;
			})(),
		});
		expect(stepTaskToNextOperation(task, MODE.SEND, undefined)).toEqual({
			kind: OPERATION.ROUTE_ERROR,
			payload: error,
		});
	});

	test("routing ignores whether the task had already finished", () => {
		const task = makeTask();
		const operation = endTaskWithError(task, new Error("late"));
		expect(operation.kind).toBe(OPERATION.ROUTE_ERROR);
	});
});

describe("the suspension: what a task is parked on", () => {
	//every late-arriving continuation guards on this one field, so which yields park the task and
	//what clears it is the whole contract
	test.each([
		["a generator function", () => function* () {}],
		["a render function", () => () => template()],
	] as const)("%s parks the task at a renderable yield", (_label, make) => {
		const task = makeTask();
		classifyStep(task, yielded(make()));
		expect(isParkedAtARenderableYield(task)).toBe(true);
	});

	test.each([
		["a template", (): unknown => template()],
		["a promise", (): unknown => Promise.resolve("x")],
		["a plain value", (): unknown => 42],
	] as const)("%s parks the task at nothing renderable", (_label, make) => {
		const task = makeTask();
		classifyStep(task, yielded(make()));
		expect(isParkedAtARenderableYield(task)).toBe(false);
	});

	//the step is the only writer that clears it, which is what makes the field cover every route
	//out of a yield rather than the ones a classifier happens to know about
	test("stepping clears it, so a refire cannot resume a generator that moved on", () => {
		const task = makeTask(parkedAtARenderable());
		stepTaskToNextOperation(task, MODE.SEND, undefined);
		expect(task.suspension).toBe(null);
	});

	test("an async step parks the task before the generator can settle", () => {
		//an async generator has left its yield the moment it is resumed, not when the step resolves
		const task = makeTask({
			generator: (async function* () {
				yield 1;
			})(),
		});
		const stepped = stepTaskToNextOperation(task, MODE.SEND, undefined);
		expect(stepped.kind).toBe(OPERATION.DEFERRED);
		expect(task.suspension).not.toBe(null);
		expect(isParkedAtARenderableYield(task)).toBe(false);
	});

	//identity is the permit: leaving a park and returning to an equivalent one must invalidate
	//whatever the first park handed out, which a compared value could never express
	test("re-parking at another renderable yield still issues a new permit", () => {
		const task = makeTask();
		classifyStep(
			task,
			yielded(() => template()),
		);
		const firstPark = task.suspension;
		stepTaskToNextOperation(task, MODE.SEND, undefined);
		classifyStep(
			task,
			yielded(() => template()),
		);
		expect(isParkedAtARenderableYield(task)).toBe(true);
		expect(task.suspension).not.toBe(firstPark);
	});
});

describe("each operation is its own object", () => {
	//every payload read used to be ordered against the next createOperation call; nothing aliases
	//now, so an operation stays readable after the step that follows it
	test("a later classification does not overwrite an earlier operation", () => {
		const task = makeTask();
		const first = classifyStep(task, yielded(1));
		const second = classifyStep(task, yielded(2));
		expect(second).not.toBe(first);
		expect(first.payload).toBe(1);
	});
});
