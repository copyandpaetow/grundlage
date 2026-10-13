import {
	Cleanup,
	ComponentGenerator,
	ComponentProps,
	ContentValue,
	RenderFunction,
} from "../types";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import {
	ComponentRoot,
	displayFatalErrorInRoot,
	paintComponentRoot,
} from "../rendering/component-root";
import { isServer } from "../utils/guards";
import { ValueOf } from "../utils/types";
import {
	forgetAncestorRun,
	hasQueuedAncestorRun,
	NEVER_SEARCHED,
	OrderedRun,
	registerRunForHost,
} from "./render-order";
import {
	cancelTaskAndRunCleanup,
	createRenderTask,
	isGeneratorFunction,
	isParkedAtRenderableYield,
	isStillParkedAt,
	Suspension,
	Task,
} from "./task";
import { isTemplate } from "../template";
import {
	assertDuringDevelopment,
	InvariantError,
	libraryMessage,
	warnDuringDevelopment,
} from "../utils/diagnostics";

interface RenderRunSetup {
	root: ComponentRoot;
	componentProps: ComponentProps;
	componentGenerator: ComponentGenerator;
}

export interface RenderRun extends RenderRunSetup, OrderedRun {
	//set on enqueue, cleared on dequeue: the run whose paint asked for this render. Any run can be
	//the causer, since a paint reaches a component beside it through a plain setter
	blockedByRun: RenderRun | null;
	componentGeneratorTask: Task | null;
	currentRenderable: RenderFunction | ComponentGenerator | null;
	//only the result of the latest call may continue: an older async result compares unequal
	renderCallNumber: number;
	pendingUpdate: PromiseWithResolvers<void> | null;
	wasMountedOnServer: boolean;
	hasEndedWithFatalError: boolean;
	lastRenderedInPassNumber: number;
	renderCountInPass: number;
}

interface RenderScheduler {
	queuedRuns: Set<RenderRun>;
	runCurrentlyPainting: RenderRun | null;
	passNumber: number;
	isPassScheduled: boolean;
	isPassRunning: boolean;
	//a pass that goes all the way round the queue without rendering anything is holding a ring of
	//runs waiting for each other, which no further trip can break
	passedOverRunCountSinceLastRender: number;
	//how many driver loops are on the stack right now. A nested generator and a component mounted
	//from post-yield code each drive a second loop while the generator that reached them is still
	//parked mid-step, and that generator must not see the queue drain under it
	generatorCountOnStack: number;
}

const createRenderScheduler = (): RenderScheduler => ({
	queuedRuns: new Set(),
	runCurrentlyPainting: null,
	passNumber: 0,
	isPassScheduled: false,
	isPassRunning: false,
	passedOverRunCountSinceLastRender: 0,
	generatorCountOnStack: 0,
});

//one for the page: a parent renders before its child only when both drain from the same queue
const scheduler = createRenderScheduler();

const RENDERS_PER_RUN_IN_ONE_PASS_LIMIT = 100;
const STEPS_PER_DRIVER_LOOP_LIMIT = 10_000;

//the pass number starts at 0 and only grows
const NEVER_RENDERED_IN_PASS = -1;

const RUNAWAY_RENDER_MESSAGE = libraryMessage(
	"a component rendered too often in one pass. A render is writing a value that schedules it again: move that write out of the render, or write only when the value differs",
);

const WAITING_FOR_EACH_OTHER_MESSAGE = libraryMessage(
	"components are waiting for each other to render. One of them writes into a component that writes back into it: let only one of them write to the other",
);

const ENDLESS_SYNCHRONOUS_STEPS_MESSAGE = libraryMessage(
	`a generator took ${STEPS_PER_DRIVER_LOOP_LIMIT} steps without waiting. Yield a template, a render function or a promise, or await between values`,
);

const NESTED_GENERATOR_DEPTH_MESSAGE = libraryMessage(
	"an inner generator may not install another one. One level of nesting only",
);

export const alreadySettled = Promise.resolve();

export const createRenderRun = (setup: RenderRunSetup): RenderRun => {
	const run: RenderRun = {
		...setup,
		blockedByRun: null,
		componentGeneratorTask: null,
		currentRenderable: null,
		renderCallNumber: 0,
		pendingUpdate: null,
		wasMountedOnServer: false,
		hasEndedWithFatalError: false,
		lastRenderedInPassNumber: NEVER_RENDERED_IN_PASS,
		renderCountInPass: 0,
		ancestorRun: null,
		lastAncestorSearchAtHostRegistrationCount: NEVER_SEARCHED,
	};
	registerRunForHost(run);
	return run;
};

const runScheduledPass = (): void => {
	scheduler.isPassScheduled = false;
	runOnePass();
};

const enqueue = (run: RenderRun): void => {
	const painter = scheduler.runCurrentlyPainting;
	//an update from outside a paint says nothing about order, so it may not erase what a paint said
	if (painter !== null) run.blockedByRun = painter === run ? null : painter;
	scheduler.queuedRuns.add(run);
	const needsPass = !scheduler.isPassScheduled && !scheduler.isPassRunning;
	if (!needsPass) return;
	scheduler.isPassScheduled = true;
	queueMicrotask(runScheduledPass);
};

//the queue drains in a later microtask than the one that filled it, so the phase a run was queued
//in can be gone by the time it is taken out
const renderQueuedRun = (run: RenderRun): void => {
	//an edge that outlived its render would block a later one, and holding the causer pins its host
	run.blockedByRun = null;
	const phase = phaseOf(run);
	switch (phase) {
		//dropped rather than deferred: the mark is back on, or the host left the document. The mark
		//comes off with a START of its own, and a removal settles any pending update() through the
		//STOP that follows it
		case RENDER_PHASE.NOT_CONNECTED:
		case RENDER_PHASE.ENDED_BY_FATAL_ERROR:
		case RENDER_PHASE.WAITING_FOR_PARENT_VALUES:
			return;
		case RENDER_PHASE.READY_TO_START:
		case RENDER_PHASE.RUNNING:
			break;
		default:
			return phase satisfies never;
	}
	//passing a run over costs nothing but a trip round the queue, so only a render that happened
	//counts against the limit. A chain of a thousand components is deep, not runaway
	if (run.lastRenderedInPassNumber !== scheduler.passNumber) {
		run.lastRenderedInPassNumber = scheduler.passNumber;
		run.renderCountInPass = 0;
	}
	run.renderCountInPass++;
	if (run.renderCountInPass > RENDERS_PER_RUN_IN_ONE_PASS_LIMIT) {
		endRunWithFatalError(run, new Error(RUNAWAY_RENDER_MESSAGE));
		return;
	}
	if (phase === RENDER_PHASE.READY_TO_START) mountComponentGenerator(run);
	else rerunCurrentRenderable(run);
};

//a re-add moves a run to the back, so it renders only after everything it follows. A full pass
//with nothing rendered means the runs wait on each other, so the one under the cursor ends visibly
const requeueBehindBlockers = (run: RenderRun): void => {
	scheduler.queuedRuns.add(run);
	scheduler.passedOverRunCountSinceLastRender++;
	const everyQueuedRunHasBeenPassedOver =
		scheduler.passedOverRunCountSinceLastRender > scheduler.queuedRuns.size;
	if (!everyQueuedRunHasBeenPassedOver) return;
	scheduler.passedOverRunCountSinceLastRender = 0;
	endRunWithFatalError(run, new Error(WAITING_FOR_EACH_OTHER_MESSAGE));
};

const runOnePass = (): void => {
	scheduler.isPassRunning = true;
	scheduler.passNumber++;
	scheduler.passedOverRunCountSinceLastRender = 0;
	try {
		for (const run of scheduler.queuedRuns) {
			scheduler.queuedRuns.delete(run);
			//the causal edge is exact, so where a paint asked for this render there is nothing to infer
			const isBlockedByQueuedRun =
				run.blockedByRun === null
					? hasQueuedAncestorRun(run, scheduler.queuedRuns)
					: scheduler.queuedRuns.has(run.blockedByRun);
			if (isBlockedByQueuedRun) {
				requeueBehindBlockers(run);
				continue;
			}
			scheduler.passedOverRunCountSinceLastRender = 0;
			renderQueuedRun(run);
		}
	} finally {
		scheduler.isPassRunning = false;
		const needsAnotherPass =
			!scheduler.isPassScheduled && scheduler.queuedRuns.size > 0;
		if (needsAnotherPass) {
			scheduler.isPassScheduled = true;
			queueMicrotask(runScheduledPass);
		}
	}
};

//derived, never stored: every field it reads is written by the driver itself, so a stored phase
//would be a second source of truth to keep in step
const RENDER_PHASE = {
	NOT_CONNECTED: 140,
	WAITING_FOR_PARENT_VALUES: 141,
	READY_TO_START: 142,
	RUNNING: 143,
	ENDED_BY_FATAL_ERROR: 144,
} as const;

//spelled, not numbered: RENDER_PHASE covers the same small integers, and a phase handed to
//requestRender would otherwise typecheck as some other request
export const RENDER_REQUEST = {
	START: "start",
	STOP: "stop",
	DISCONNECT: "disconnect",
	RERENDER: "rerender",
} as const;

const phaseOf = (run: RenderRun): ValueOf<typeof RENDER_PHASE> => {
	//ahead of the task, because disconnectedCallback is a microtask behind the removal: between the
	//two a run still holds everything RUNNING reads, and its host is already nowhere
	if (!run.root.host.isConnected) return RENDER_PHASE.NOT_CONNECTED;
	//a fatal error can land before the first START, from a prop that throws on a detached element,
	//and that START must not paint over it
	if (run.hasEndedWithFatalError) return RENDER_PHASE.ENDED_BY_FATAL_ERROR;
	if (run.componentGeneratorTask !== null) return RENDER_PHASE.RUNNING;
	//the server writes the mark while the child sits in the parent's detached fragment, so it is
	//already present when that fragment is connected and the child would otherwise paint its own run
	return !isServer() && run.root.host.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)
		? RENDER_PHASE.WAITING_FOR_PARENT_VALUES
		: RENDER_PHASE.READY_TO_START;
};

//the one entry into render timing: a call site reports what happened to it, the phase decides
//whether that does anything
export const requestRender = (
	run: RenderRun,
	request: ValueOf<typeof RENDER_REQUEST>,
): Promise<void> => {
	switch (request) {
		case RENDER_REQUEST.START:
			if (phaseOf(run) === RENDER_PHASE.READY_TO_START) {
				//a top-level mount stays synchronous; one inside a paint joins that paint
				if (scheduler.runCurrentlyPainting === null)
					mountComponentGenerator(run);
				else enqueue(run);
			}
			return alreadySettled;
		//the one request the phase cannot answer: a host that is gone reads NOT_CONNECTED whether or
		//not it left a running task, a queue entry and an unsettled update() behind, and all three go
		case RENDER_REQUEST.STOP:
			cancelRenderRun(run);
			return alreadySettled;
		//synchronous, unlike STOP: a removal and re-insertion in one task never reaches STOP, and the
		//re-insertion is the one way back from a fatal error
		case RENDER_REQUEST.DISCONNECT:
			run.hasEndedWithFatalError = false;
			//a move is a removal before an insertion, and it can put the causer below this run
			run.blockedByRun = null;
			return alreadySettled;
		case RENDER_REQUEST.RERENDER: {
			const hasRenderableToRerun =
				phaseOf(run) === RENDER_PHASE.RUNNING && run.currentRenderable !== null;
			if (!hasRenderableToRerun) return alreadySettled;
			run.pendingUpdate ??= Promise.withResolvers<void>();
			enqueue(run);
			return run.pendingUpdate.promise;
		}
		default:
			return request satisfies never;
	}
};

//every field is cleared before either cleanup runs: a cleanup is user code that can call update() or
//read the host, and it has to find a run that is already fully stopped
const cancelRenderRun = (run: RenderRun): void => {
	scheduler.queuedRuns.delete(run);
	forgetAncestorRun(run);
	run.blockedByRun = null;
	const componentGeneratorTask = run.componentGeneratorTask;
	run.componentGeneratorTask = null;
	run.currentRenderable = null;
	run.renderCallNumber++;
	if (componentGeneratorTask !== null) {
		const nestedGeneratorTask = componentGeneratorTask.nestedGeneratorTask;
		if (nestedGeneratorTask !== null)
			cancelTaskAndRunCleanup(nestedGeneratorTask);
		cancelTaskAndRunCleanup(componentGeneratorTask);
	}
	const updatePromise = run.pendingUpdate;
	run.pendingUpdate = null;
	updatePromise?.resolve();
};

export const endRunWithFatalError = (run: RenderRun, error: unknown): void => {
	cancelRenderRun(run);
	run.hasEndedWithFatalError = true;
	displayFatalErrorInRoot(run.root, error);
};

const settleRun = (run: RenderRun): void => {
	const queuedRenderWillCompleteRun = scheduler.queuedRuns.has(run);
	if (run.wasMountedOnServer) {
		if (!queuedRenderWillCompleteRun) cancelRenderRun(run);
		return;
	}
	if (queuedRenderWillCompleteRun) return;
	const updatePromise = run.pendingUpdate;
	run.pendingUpdate = null;
	updatePromise?.resolve();
};

const cancelNestedGeneratorTask = (componentGeneratorTask: Task): void => {
	const nestedGeneratorTask = componentGeneratorTask.nestedGeneratorTask;
	if (nestedGeneratorTask === null) return;
	componentGeneratorTask.nestedGeneratorTask = null;
	componentGeneratorTask.run.renderCallNumber++;
	cancelTaskAndRunCleanup(nestedGeneratorTask);
};

const mountComponentGenerator = (run: RenderRun): void => {
	run.wasMountedOnServer = isServer();
	const componentGeneratorTask = createRenderTask(
		run,
		run.componentGenerator(run.componentProps),
	);
	run.componentGeneratorTask = componentGeneratorTask;
	driveTask(componentGeneratorTask, ARRIVAL.VALUE_TO_SEND, undefined);
};

const rerunCurrentRenderable = (run: RenderRun): void => {
	const componentGeneratorTask = run.componentGeneratorTask;
	const renderable = run.currentRenderable;
	const hasNothingToRerun =
		componentGeneratorTask === null || renderable === null;
	if (hasNothingToRerun) {
		const updatePromise = run.pendingUpdate;
		run.pendingUpdate = null;
		updatePromise?.resolve();
		return;
	}
	driveTask(componentGeneratorTask, arrivalForYield(renderable), renderable);
};

//what the next turn of the loop does with the payload
const ARRIVAL = {
	VALUE_TO_SEND: 150,
	ERROR_TO_THROW: 151,
	STEP_RESULT: 152,
	RENDER_FUNCTION: 153,
	RENDER_OUTPUT: 154,
	NESTED_GENERATOR: 155,
	TASK_ERROR: 156,
} as const;

type ArrivalKind = ValueOf<typeof ARRIVAL>;

//step, step result, render function, render output, nested generator
const MOST_TURNS_PER_GENERATOR_STEP = 5;

const NO_CATCHER: unique symbol = Symbol("no catcher");

const driveTask = (
	task: Task,
	arrival: ArrivalKind,
	payload: unknown,
): void => {
	scheduler.generatorCountOnStack++;
	try {
		driveTaskUntilItStops(task, arrival, payload);
	} finally {
		scheduler.generatorCountOnStack--;
		//a queued run renders when no generator is left on the stack, so a pass either is already
		//running and will reach it, or starts here and now
		const mayRenderWhatIsQueued =
			scheduler.generatorCountOnStack === 0 &&
			!scheduler.isPassRunning &&
			scheduler.queuedRuns.size > 0;
		if (mayRenderWhatIsQueued) runOnePass();
	}
};

//the yield position makes every function a render function or a body; a promise is handled before
//this, and anything else is echoed back to the generator
const arrivalForYield = (yielded: unknown): ArrivalKind => {
	if (isTemplate(yielded) || isGeneratorFunction(yielded))
		return ARRIVAL.RENDER_OUTPUT;
	if (typeof yielded === "function") return ARRIVAL.RENDER_FUNCTION;
	return ARRIVAL.VALUE_TO_SEND;
};

const cleanupOf = (returned: unknown): Cleanup | null => {
	//the type layer holds the return position to Cleanup | void
	if (typeof returned === "function") return returned as Cleanup;
	//nothing downstream reads a non-function return, so without this the drop is invisible to
	//anyone not running the types
	if (returned !== undefined)
		warnDuringDevelopment(
			"the generator returned a value that is not a function, so it was dropped. The return position is the cleanup function.",
		);
	return null;
};

const canBeCommittedAsContent = (value: unknown): value is ContentValue =>
	value === null ||
	(typeof value !== "object" &&
		typeof value !== "function" &&
		typeof value !== "symbol") ||
	isTemplate(value) ||
	Array.isArray(value);

const assertPaintable: (output: unknown) => asserts output is ContentValue = (
	output,
) => {
	if (!canBeCommittedAsContent(output))
		throw new Error(
			libraryMessage(
				typeof output === "function"
					? "the render function returned a plain function. A generator function body needs the *."
					: "the render function returned a value that cannot be rendered. Return a template, a primitive or an array of those.",
			),
		);
	//an empty render is legal, so this one warns and paints nothing
	if (output === undefined)
		warnDuringDevelopment(
			"the render function returned undefined, so nothing was rendered. A block body needs an explicit return.",
		);
};

//only the component generator can catch, and only at a renderable yield: anything else ends the run
const catcherOf = (task: Task): Task | typeof NO_CATCHER => {
	const componentGeneratorTask = task.run.componentGeneratorTask;
	const noGeneratorCanCatchIt =
		task === componentGeneratorTask ||
		componentGeneratorTask === null ||
		!isParkedAtRenderableYield(componentGeneratorTask);
	return noGeneratorCanCatchIt ? NO_CATCHER : componentGeneratorTask;
};

//a step that hands its result on sets arrival and payload and breaks, so every write stays in this
//loop and the steps read top to bottom instead of nesting inside each other
const driveTaskUntilItStops = (
	startTask: Task,
	startArrival: ArrivalKind,
	startPayload: unknown,
): void => {
	const run = startTask.run;
	let task = startTask;
	let arrival = startArrival;
	let payload = startPayload;
	for (
		let turn = 0;
		turn < STEPS_PER_DRIVER_LOOP_LIMIT * MOST_TURNS_PER_GENERATOR_STEP;
		turn++
	) {
		try {
			//the arrival says what the payload holds
			switch (arrival) {
				case ARRIVAL.VALUE_TO_SEND:
				case ARRIVAL.ERROR_TO_THROW: {
					//cleared before the call, not after: an async generator has left its yield the moment it
					//is resumed, long before the step settles, and nothing may resume it again in between
					task.suspension = null;
					const stepped =
						arrival === ARRIVAL.ERROR_TO_THROW
							? task.generator.throw(payload)
							: task.generator.next(payload);
					if (stepped instanceof Promise) {
						const suspension: Suspension = { isAtRenderableYield: false };
						task.suspension = suspension;
						void driveTaskOnceSettled(
							task,
							stepped,
							suspension,
							ARRIVAL.STEP_RESULT,
						);
						return;
					}
					arrival = ARRIVAL.STEP_RESULT;
					payload = stepped;
					break;
				}
				case ARRIVAL.STEP_RESULT: {
					const result = payload as IteratorResult<unknown>;
					if (result.done) {
						task.cleanup = cleanupOf(result.value);
						settleRun(run);
						return;
					}
					const yielded = result.value;
					if (yielded instanceof Promise) {
						const suspension: Suspension = { isAtRenderableYield: false };
						task.suspension = suspension;
						void driveTaskOnceSettled(
							task,
							yielded,
							suspension,
							ARRIVAL.VALUE_TO_SEND,
						);
						return;
					}
					arrival = arrivalForYield(yielded);
					payload = yielded;
					if (arrival === ARRIVAL.VALUE_TO_SEND) break;
					task.suspension = { isAtRenderableYield: true };
					//a plainly yielded template is a one-shot: update() has nothing to re-fire until the next
					//yield. What a nested task yields belongs to the generator function update() re-installs
					if (task === run.componentGeneratorTask)
						run.currentRenderable = isTemplate(yielded)
							? null
							: (yielded as RenderFunction | ComponentGenerator);
					break;
				}
				case ARRIVAL.RENDER_FUNCTION: {
					const renderCallNumber = ++run.renderCallNumber;
					const produced = (payload as RenderFunction)(run.componentProps);
					if (produced instanceof Promise) {
						void driveTaskOnceRenderSettles(task, produced, renderCallNumber);
						return;
					}
					arrival = ARRIVAL.RENDER_OUTPUT;
					payload = produced;
					break;
				}
				case ARRIVAL.RENDER_OUTPUT: {
					if (isGeneratorFunction(payload)) {
						arrival = ARRIVAL.NESTED_GENERATOR;
						break;
					}
					assertPaintable(payload);
					if (task === run.componentGeneratorTask)
						cancelNestedGeneratorTask(task);
					const previousPainter = scheduler.runCurrentlyPainting;
					scheduler.runCurrentlyPainting = run;
					try {
						paintComponentRoot(run.root, payload, run.wasMountedOnServer);
					} finally {
						scheduler.runCurrentlyPainting = previousPainter;
					}
					const generatorMayResumeAfterPaint =
						!run.wasMountedOnServer && isParkedAtRenderableYield(task);
					if (!generatorMayResumeAfterPaint) {
						settleRun(run);
						return;
					}
					arrival = ARRIVAL.VALUE_TO_SEND;
					payload = run.root.host;
					break;
				}
				//the nested generator runs until it parks, and only then does the component's own
				//generator continue past the yield that installed it
				case ARRIVAL.NESTED_GENERATOR: {
					if (task !== run.componentGeneratorTask)
						throw new Error(NESTED_GENERATOR_DEPTH_MESSAGE);
					const componentGeneratorMayResumeOnceNestedOneParks =
						!run.wasMountedOnServer && isParkedAtRenderableYield(task);
					const componentGeneratorResumePermit =
						componentGeneratorMayResumeOnceNestedOneParks
							? task.suspension
							: null;
					cancelNestedGeneratorTask(task);
					const nestedGeneratorTask = createRenderTask(
						run,
						(payload as ComponentGenerator)(run.componentProps),
					);
					task.nestedGeneratorTask = nestedGeneratorTask;
					driveTask(nestedGeneratorTask, ARRIVAL.VALUE_TO_SEND, undefined);
					if (!isStillParkedAt(task, componentGeneratorResumePermit)) return;
					arrival = ARRIVAL.VALUE_TO_SEND;
					payload = run.root.host;
					break;
				}
				//an async failure is thrown again here so the loop's one catch routes it
				case ARRIVAL.TASK_ERROR:
					throw payload;
				default:
					return arrival satisfies never;
			}
		} catch (error) {
			if (error instanceof InvariantError) throw error;
			task.suspension = null;
			const catcher = catcherOf(task);
			if (catcher === NO_CATCHER) {
				endRunWithFatalError(run, error);
				return;
			}
			cancelNestedGeneratorTask(catcher);
			run.currentRenderable = null;
			task = catcher;
			arrival = ARRIVAL.ERROR_TO_THROW;
			payload = error;
		}
	}
	endRunWithFatalError(run, new Error(ENDLESS_SYNCHRONOUS_STEPS_MESSAGE));
};

//the async functions sit outside the loop: a synchronous render never pays for the promise an async
//function allocates on every call
const driveTaskOnceSettled = async (
	task: Task,
	settling: Promise<unknown>,
	suspension: Suspension,
	fulfilledArrival: typeof ARRIVAL.STEP_RESULT | typeof ARRIVAL.VALUE_TO_SEND,
): Promise<void> => {
	let value: unknown;
	try {
		value = await settling;
	} catch (error) {
		//a rejected step is the generator failing; a rejected yielded promise is thrown at its yield
		if (isStillParkedAt(task, suspension))
			driveTask(
				task,
				fulfilledArrival === ARRIVAL.STEP_RESULT
					? ARRIVAL.TASK_ERROR
					: ARRIVAL.ERROR_TO_THROW,
				error,
			);
		return;
	}
	if (isStillParkedAt(task, suspension))
		driveTask(task, fulfilledArrival, value);
};

//only the result of the latest call may continue: an older one compares unequal
const driveTaskOnceRenderSettles = async (
	task: Task,
	produced: Promise<unknown>,
	renderCallNumber: number,
): Promise<void> => {
	let value: unknown;
	try {
		value = await produced;
	} catch (error) {
		if (task.run.renderCallNumber === renderCallNumber)
			driveTask(task, ARRIVAL.TASK_ERROR, error);
		return;
	}
	assertDuringDevelopment(
		!(value instanceof Promise),
		"await unwraps thenables, so a settled render result is never another promise",
	);
	if (task.run.renderCallNumber === renderCallNumber)
		driveTask(task, ARRIVAL.RENDER_OUTPUT, value);
};
