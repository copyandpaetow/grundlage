import {
	BaseComponent,
	ComponentGenerator,
	ComponentProps,
	ContentValue,
	RenderFunction,
} from "../types";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import { isGeneratorFunction, isServer } from "../utils/guards";
import { ValueOf } from "../utils/types";
import {
	createRunOrdering,
	isBlockedByAQueuedRun,
	OrderedRun,
	recordWhoCausedThisRender,
	registerRunForItsHost,
	forgetWhereThisRunSits,
	forgetWhoCausedThisRender,
} from "./render-order";
import {
	cancelTaskAndRunCleanup,
	classifyRenderResultAsOperation,
	createOperation,
	createRenderTask,
	DriverStep,
	endTaskWithError,
	isParkedAtARenderableYield,
	isStillParkedAt,
	MODE,
	OPERATION,
	RELEASE_CONTROL,
	stepTaskToNextOperation,
	Task,
} from "./task";

//paint and displayFatalError reach private element state, so the coroutine cannot perform them.
//paint signals failure by throwing, the channel the loop already routes into the generator
interface RenderRunSetup {
	host: BaseComponent;
	componentProps: ComponentProps;
	componentGenerator: ComponentGenerator;
	paint: (value: ContentValue) => void;
	displayFatalError: (error: unknown) => void;
}

export interface RenderRun extends RenderRunSetup, OrderedRun {
	componentGeneratorTask: Task | null;
	nestedGeneratorTask: Task | null;
	currentRenderable: RenderFunction | ComponentGenerator | null;
	//only the result of the latest call may continue: an older async result compares unequal
	renderCallNumber: number;
	pendingUpdate: PromiseWithResolvers<void> | null;
	wasMountedOnTheServer: boolean;
	lastRenderedInPassNumber: number;
	rendersInThisPass: number;
}

interface RenderScheduler {
	queuedRuns: Set<RenderRun>;
	runCurrentlyPainting: RenderRun | null;
	passNumber: number;
	isPassScheduled: boolean;
	isPassRunning: boolean;
	//a pass that goes all the way round the queue without rendering anything is holding a ring of
	//runs waiting for each other, which no further trip can break
	runsPassedOverSinceTheLastRender: number;
	//how many driver loops are on the stack right now. A nested generator and a component mounted
	//from post-yield code each drive a second loop while the generator that reached them is still
	//parked mid-step, and that generator must not see the queue drain under it
	generatorsOnTheStack: number;
}

const createRenderScheduler = (): RenderScheduler => ({
	queuedRuns: new Set(),
	runCurrentlyPainting: null,
	passNumber: 0,
	isPassScheduled: false,
	isPassRunning: false,
	runsPassedOverSinceTheLastRender: 0,
	generatorsOnTheStack: 0,
});

const scheduler = createRenderScheduler();

const RENDERS_PER_RUN_IN_ONE_PASS_LIMIT = 100;

const RUNAWAY_RENDER_MESSAGE =
	"grundlage: a component rendered too often in one pass. A render is writing a value that schedules it again";

const WAITING_FOR_EACH_OTHER_MESSAGE =
	"grundlage: components are waiting for each other to render. One of them writes into a component that writes back into it";

const NESTED_GENERATOR_DEPTH_MESSAGE =
	"grundlage: an inner generator may not install another one. One level of nesting only";

export const alreadySettled = Promise.resolve();

export const createRenderRun = (setup: RenderRunSetup): RenderRun => {
	const run: RenderRun = {
		...setup,
		componentGeneratorTask: null,
		nestedGeneratorTask: null,
		currentRenderable: null,
		renderCallNumber: 0,
		pendingUpdate: null,
		wasMountedOnTheServer: false,
		lastRenderedInPassNumber: -1,
		rendersInThisPass: 0,
		...createRunOrdering(),
	};
	registerRunForItsHost(run);
	return run;
};

const ensureAPassIsScheduled = (): void => {
	if (scheduler.isPassScheduled || scheduler.isPassRunning) return;
	if (scheduler.queuedRuns.size === 0) return;
	scheduler.isPassScheduled = true;
	queueMicrotask(runTheScheduledPass);
};

const takeTheStackForThisDriverLoop = (): void => {
	scheduler.generatorsOnTheStack++;
};

//a queued run renders when no generator is left on the stack, so a pass either is already running
//and will reach it, or starts here and now
const leaveTheStackAndRenderWhatIsQueued = (): void => {
	if (--scheduler.generatorsOnTheStack > 0) return;
	if (scheduler.isPassRunning || scheduler.queuedRuns.size === 0) return;
	runOnePass();
};

const runTheScheduledPass = (): void => {
	scheduler.isPassScheduled = false;
	runOnePass();
};

const enqueue = (run: RenderRun): void => {
	recordWhoCausedThisRender(run, scheduler.runCurrentlyPainting);
	scheduler.queuedRuns.add(run);
	ensureAPassIsScheduled();
};

//passing a run over costs nothing but a trip round the queue, so only a render that happened counts
//against the limit. A chain of a thousand components is deep, not runaway
const countThisRenderAndCheckForARunaway = (run: RenderRun): boolean => {
	if (run.lastRenderedInPassNumber !== scheduler.passNumber) {
		run.lastRenderedInPassNumber = scheduler.passNumber;
		run.rendersInThisPass = 0;
	}
	return ++run.rendersInThisPass > RENDERS_PER_RUN_IN_ONE_PASS_LIMIT;
};

//the queue drains in a later microtask than the one that filled it, so the phase a run was queued
//in can be gone by the time it is taken out
const renderQueuedRun = (run: RenderRun): void => {
	forgetWhoCausedThisRender(run);
	const phase = phaseOf(run);
	switch (phase) {
		//dropped rather than deferred: the mark is back on, or the host left the document. The mark
		//comes off with a START of its own, and a removal settles any pending update() through the
		//STOP that follows it
		case RENDER_PHASE.NOT_CONNECTED:
		case RENDER_PHASE.WAITING_FOR_THE_PARENT_THAT_OWES_IT_A_VALUE:
			return;
		//breaking out instead of rendering is the runaway: the tail below is the only place it ends
		case RENDER_PHASE.READY_TO_START:
			if (countThisRenderAndCheckForARunaway(run)) break;
			return mountComponentGenerator(run);
		case RENDER_PHASE.RUNNING:
			if (countThisRenderAndCheckForARunaway(run)) break;
			return rerunCurrentRenderable(run);
		default:
			return phase satisfies never;
	}
	endRunWithFatalError(run, new Error(RUNAWAY_RENDER_MESSAGE));
};

//a re-add moves a run to the back, so it renders only after everything it follows. A full pass
//with nothing rendered means the runs wait on each other, so the one under the cursor ends visibly
const requeueBehindItsBlockers = (run: RenderRun): void => {
	scheduler.queuedRuns.add(run);
	scheduler.runsPassedOverSinceTheLastRender++;
	const everyQueuedRunHasBeenPassedOver =
		scheduler.runsPassedOverSinceTheLastRender > scheduler.queuedRuns.size;
	if (!everyQueuedRunHasBeenPassedOver) return;
	scheduler.runsPassedOverSinceTheLastRender = 0;
	endRunWithFatalError(run, new Error(WAITING_FOR_EACH_OTHER_MESSAGE));
};

const runOnePass = (): void => {
	scheduler.isPassRunning = true;
	scheduler.passNumber++;
	scheduler.runsPassedOverSinceTheLastRender = 0;
	try {
		for (const run of scheduler.queuedRuns) {
			scheduler.queuedRuns.delete(run);
			if (isBlockedByAQueuedRun(run, scheduler.queuedRuns)) {
				requeueBehindItsBlockers(run);
				continue;
			}
			scheduler.runsPassedOverSinceTheLastRender = 0;
			renderQueuedRun(run);
		}
	} finally {
		scheduler.isPassRunning = false;
		ensureAPassIsScheduled();
	}
};

//derived, never stored: every field it reads is written by the driver itself, so a stored phase
//would be a second source of truth to keep in step
const RENDER_PHASE = {
	NOT_CONNECTED: 0,
	WAITING_FOR_THE_PARENT_THAT_OWES_IT_A_VALUE: 1,
	READY_TO_START: 2,
	RUNNING: 3,
} as const;

//spelled, not numbered: RENDER_PHASE covers the same small integers, and a phase handed to
//requestRender would otherwise typecheck as some other request
export const RENDER_REQUEST = {
	START: "start",
	STOP: "stop",
	RERENDER: "rerender",
} as const;

const phaseOf = (run: RenderRun): ValueOf<typeof RENDER_PHASE> => {
	//ahead of the task, because disconnectedCallback is a microtask behind the removal: between the
	//two a run still holds everything RUNNING reads, and its host is already nowhere
	if (!run.host.isConnected) return RENDER_PHASE.NOT_CONNECTED;
	if (run.componentGeneratorTask !== null) return RENDER_PHASE.RUNNING;
	//the server writes the mark while the child sits in the parent's detached fragment, so it is
	//already present when that fragment is connected and the child would otherwise paint its own run
	return !isServer() && run.host.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)
		? RENDER_PHASE.WAITING_FOR_THE_PARENT_THAT_OWES_IT_A_VALUE
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
		case RENDER_REQUEST.RERENDER: {
			const thereIsSomethingToRerun =
				phaseOf(run) === RENDER_PHASE.RUNNING && run.currentRenderable !== null;
			return thereIsSomethingToRerun ? scheduleUpdate(run) : alreadySettled;
		}
		default:
			return request satisfies never;
	}
};

const resolvePendingUpdatePromise = (run: RenderRun): void => {
	const updatePromise = run.pendingUpdate;
	if (updatePromise === null) return;
	run.pendingUpdate = null;
	updatePromise.resolve();
};

//every field is cleared before either cleanup runs: a cleanup is user code that can call update() or
//read the host, and it has to find a run that is already fully stopped
const cancelRenderRun = (run: RenderRun): void => {
	scheduler.queuedRuns.delete(run);
	forgetWhereThisRunSits(run);
	const nestedGeneratorTask = run.nestedGeneratorTask;
	const componentGeneratorTask = run.componentGeneratorTask;
	run.nestedGeneratorTask = run.componentGeneratorTask = null;
	run.currentRenderable = null;
	run.renderCallNumber++;
	cancelTaskAndRunCleanup(nestedGeneratorTask);
	cancelTaskAndRunCleanup(componentGeneratorTask);
	resolvePendingUpdatePromise(run);
};

export const endRunWithFatalError = (run: RenderRun, error: unknown): void => {
	cancelRenderRun(run);
	run.displayFatalError(error);
};

const completeRun = (run: RenderRun): void => {
	if (run.wasMountedOnTheServer) return cancelRenderRun(run);
	const aQueuedUpdateWillAnswerTheAwaitInstead = scheduler.queuedRuns.has(run);
	if (aQueuedUpdateWillAnswerTheAwaitInstead) return;
	resolvePendingUpdatePromise(run);
};

const cancelNestedGeneratorTask = (run: RenderRun): void => {
	const nestedGeneratorTask = run.nestedGeneratorTask;
	if (nestedGeneratorTask === null) return;
	run.nestedGeneratorTask = null;
	run.renderCallNumber++;
	cancelTaskAndRunCleanup(nestedGeneratorTask);
};

const replaceNestedGeneratorTask = (
	run: RenderRun,
	source: ComponentGenerator,
): Task => {
	cancelNestedGeneratorTask(run);
	const nestedGeneratorTask = createRenderTask(source(run.componentProps));
	run.nestedGeneratorTask = nestedGeneratorTask;
	return nestedGeneratorTask;
};

const runTaskFromItsFirstStep = (run: RenderRun, task: Task): void => {
	runTaskUntilItParksOrEnds(
		run,
		task,
		stepTaskToNextOperation(task, MODE.SEND, undefined),
	);
};

const mountComponentGenerator = (run: RenderRun): void => {
	run.wasMountedOnTheServer = isServer();
	const componentGeneratorTask = createRenderTask(
		run.componentGenerator(run.componentProps),
	);
	run.componentGeneratorTask = componentGeneratorTask;
	runTaskFromItsFirstStep(run, componentGeneratorTask);
};

const scheduleUpdate = (run: RenderRun): Promise<void> => {
	run.pendingUpdate ??= Promise.withResolvers<void>();
	enqueue(run);
	return run.pendingUpdate.promise;
};

const rerunCurrentRenderable = (run: RenderRun): void => {
	const componentGeneratorTask = run.componentGeneratorTask;
	const renderable = run.currentRenderable;
	if (componentGeneratorTask === null || renderable === null)
		return resolvePendingUpdatePromise(run);
	if (isGeneratorFunction(renderable)) {
		runTaskFromItsFirstStep(run, replaceNestedGeneratorTask(run, renderable));
		return;
	}
	runTaskUntilItParksOrEnds(
		run,
		componentGeneratorTask,
		callRenderFunction(run, componentGeneratorTask, renderable),
	);
};

const paintAndContinue = (
	run: RenderRun,
	task: Task,
	value: ContentValue,
): DriverStep => {
	if (task === run.componentGeneratorTask) cancelNestedGeneratorTask(run);
	const previousPainter = scheduler.runCurrentlyPainting;
	scheduler.runCurrentlyPainting = run;
	try {
		run.paint(value);
	} catch (error) {
		return endTaskWithError(task, error);
	} finally {
		scheduler.runCurrentlyPainting = previousPainter;
	}
	const theGeneratorMayResumeAfterThisPaint =
		!run.wasMountedOnTheServer && isParkedAtARenderableYield(task);
	if (!theGeneratorMayResumeAfterThisPaint) {
		completeRun(run);
		return RELEASE_CONTROL;
	}
	return stepTaskToNextOperation(task, MODE.SEND, run.host);
};

//the generator yielded or returned another generator: it runs until it parks, and only then does
//the component's own generator continue past the yield that installed it
const installNestedGenerator = (
	run: RenderRun,
	task: Task,
	source: ComponentGenerator,
): DriverStep => {
	if (task !== run.componentGeneratorTask)
		return endTaskWithError(task, new Error(NESTED_GENERATOR_DEPTH_MESSAGE));

	const theComponentGeneratorMayResumeOnceTheNestedOneParks =
		!run.wasMountedOnTheServer && isParkedAtARenderableYield(task);
	const componentGeneratorResumePermit =
		theComponentGeneratorMayResumeOnceTheNestedOneParks
			? task.suspension
			: null;

	runTaskFromItsFirstStep(run, replaceNestedGeneratorTask(run, source));
	if (!isStillParkedAt(task, componentGeneratorResumePermit))
		return RELEASE_CONTROL;
	return stepTaskToNextOperation(task, MODE.SEND, run.host);
};

const routeErrorToTheComponentGenerator = (
	run: RenderRun,
	task: Task,
	error: unknown,
): DriverStep => {
	const componentGeneratorTask = run.componentGeneratorTask;
	if (task === componentGeneratorTask || componentGeneratorTask === null) {
		endRunWithFatalError(run, error);
		return RELEASE_CONTROL;
	}
	cancelNestedGeneratorTask(run);
	if (!isParkedAtARenderableYield(componentGeneratorTask)) {
		endRunWithFatalError(run, error);
		return RELEASE_CONTROL;
	}
	run.currentRenderable = null;
	return stepTaskToNextOperation(componentGeneratorTask, MODE.THROW, error);
};

//the one writer of the rerender slot, so what update() re-fires is decided in a single table rather
//than by three handlers that each have to agree on it
const rememberWhatUpdateShouldRerun = (
	run: RenderRun,
	task: Task,
	step: DriverStep,
): void => {
	if (task !== run.componentGeneratorTask) return;
	switch (step.kind) {
		//a directly yielded template is a one-shot: nothing to re-fire until the next yield
		case OPERATION.PAINT_FROM_YIELD:
			run.currentRenderable = null;
			return;
		//what a render function produced belongs to that function, which is already in the slot
		case OPERATION.INSTALL_FROM_YIELD:
		case OPERATION.CALL_RENDER_FUNCTION:
			run.currentRenderable = step.payload;
			return;
		case OPERATION.PAINT_FROM_RENDER_RESULT:
		case OPERATION.INSTALL_FROM_RENDER_RESULT:
		case OPERATION.RESUME:
		case OPERATION.RESUME_WITH_ERROR:
		case OPERATION.COMPLETED:
		case OPERATION.ROUTE_ERROR:
		case OPERATION.RELEASE_CONTROL:
		case OPERATION.DEFERRED:
			return;
		default:
			return step satisfies never;
	}
};

const runTaskUntilItParksOrEnds = (
	run: RenderRun,
	startTask: Task,
	startStep: DriverStep,
): void => {
	let task = startTask;
	let next = startStep;

	takeTheStackForThisDriverLoop();
	try {
		while (true) {
			rememberWhatUpdateShouldRerun(run, task, next);
			switch (next.kind) {
				//the next step is not known yet: this loop leaves the stack, so everything queued up to
				//here renders, and a fresh loop takes over once the step settles
				case OPERATION.DEFERRED:
					void continueOnceTheStepSettles(run, task, next.payload);
					return;

				//stop: the task is waiting on something else now, or a newer render replaced this one
				case OPERATION.RELEASE_CONTROL:
					return;

				case OPERATION.PAINT_FROM_YIELD:
				case OPERATION.PAINT_FROM_RENDER_RESULT:
					next = paintAndContinue(run, task, next.payload);
					break;

				//the generator yielded a render function: calling it produces the next step which can be a
				//template to paint, a nested generator, a promise to wait on, or an error
				case OPERATION.CALL_RENDER_FUNCTION:
					next = callRenderFunction(run, task, next.payload);
					break;

				case OPERATION.INSTALL_FROM_YIELD:
				case OPERATION.INSTALL_FROM_RENDER_RESULT:
					next = installNestedGenerator(run, task, next.payload);
					break;

				//a promise the generator yielded resolved, so its value goes back into the generator
				case OPERATION.RESUME:
					next = stepTaskToNextOperation(task, MODE.SEND, next.payload);
					break;

				//that promise rejected instead: the error is thrown at the yield, where the generator's
				//own try/catch can take it
				case OPERATION.RESUME_WITH_ERROR:
					next = stepTaskToNextOperation(task, MODE.THROW, next.payload);
					break;

				case OPERATION.COMPLETED:
					completeRun(run);
					return;

				//a rerouted error resumes the loop on the component generator instead of the one that
				//failed; the fatal path nulls it and returns RELEASE_CONTROL, so the stale task is never read
				case OPERATION.ROUTE_ERROR:
					next = routeErrorToTheComponentGenerator(run, task, next.payload);
					task = run.componentGeneratorTask ?? task;
					break;

				default:
					return next satisfies never;
			}
		}
	} finally {
		leaveTheStackAndRenderWhatIsQueued();
	}
};

//the one async function in the loop: a synchronous render never reaches it, so it never pays for the
//promise an async function allocates on every call
const continueOnceTheStepSettles = async (
	run: RenderRun,
	task: Task,
	settling: Promise<DriverStep>,
): Promise<void> => {
	runTaskUntilItParksOrEnds(run, task, await settling);
};

const callRenderFunction = (
	run: RenderRun,
	task: Task,
	renderFunction: RenderFunction,
): DriverStep => {
	const renderCallNumber = ++run.renderCallNumber;
	let produced: unknown;
	try {
		produced = renderFunction(run.componentProps);
	} catch (error) {
		return endTaskWithError(task, error);
	}
	//a render result is classified, not executed: everything but the await is an operation the loop
	//already knows how to run
	return produced instanceof Promise
		? createOperation(
				OPERATION.DEFERRED,
				settleRenderResult(run, task, produced, renderCallNumber),
			)
		: classifyRenderResultAsOperation(task, produced);
};

const settleRenderResult = async (
	run: RenderRun,
	task: Task,
	promise: Promise<unknown>,
	renderCallNumber: number,
): Promise<DriverStep> => {
	let value: unknown;
	try {
		value = await promise;
	} catch (error) {
		return run.renderCallNumber === renderCallNumber
			? endTaskWithError(task, error)
			: RELEASE_CONTROL;
	}
	if (run.renderCallNumber !== renderCallNumber) return RELEASE_CONTROL;
	//await unwraps thenables, so a settled render result is never another promise
	return classifyRenderResultAsOperation(task, value);
};
