import {
	Cleanup,
	ComponentGenerator,
	ComponentProps,
	UpdateGenerator,
} from "../types";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import {
	ComponentRoot,
	displayFatalErrorInRoot,
	paintComponentRoot,
} from "../rendering/component-root";
import { flushHostPayload } from "../load";
import { isServer } from "../utils/guards";
import { ValueOf } from "../utils/types";
import {
	forgetAncestorRunner,
	hasQueuedAncestorRunner,
	NEVER_SEARCHED,
	OrderedRunner,
	registerRunnerForHost,
} from "./update-order";
import {
	createRun,
	isGeneratorFunction,
	isParkedAtTemplateOrUpdateGeneratorYield,
	isStillParkedAt,
	PARKED_AT_TEMPLATE_OR_UPDATE_GENERATOR_YIELD,
	Run,
	tearDownRun,
} from "./run";
import { isTemplate } from "../template";
import {
	assertDuringDevelopment,
	InvariantError,
	libraryMessage,
	warnDuringDevelopment,
} from "../utils/diagnostics";

interface ComponentRunnerSetup {
	root: ComponentRoot;
	componentProps: ComponentProps;
	componentGenerator: ComponentGenerator;
}

export interface ComponentRunner extends ComponentRunnerSetup, OrderedRunner {
	//set on enqueue, cleared on dequeue: the runner whose paint asked for this update. Any runner
	//can be the causer, since a paint reaches a component beside it through a plain setter
	blockedByRunner: ComponentRunner | null;
	bodyRun: Run | null;
	currentUpdateGenerator: UpdateGenerator | null;
	//the latest run of currentUpdateGenerator, kept after it finishes because its cleanup lives on it
	updateGeneratorRun: Run | null;
	pendingUpdate: PromiseWithResolvers<void> | null;
	//latched at mount rather than a fresh isServer() per use: the global is mutable, and one mount
	//must not switch sides halfway
	wasMountedOnServer: boolean;
	hasEndedWithFatalError: boolean;
	lastUpdatedInPassNumber: number;
	updateCountInPass: number;
}

interface UpdateScheduler {
	queuedRunners: Set<ComponentRunner>;
	runnerCurrentlyPainting: ComponentRunner | null;
	passNumber: number;
	isPassScheduled: boolean;
	isPassRunning: boolean;
	//a pass that goes all the way round the queue without updating anything is holding a ring of
	//runners waiting for each other, which no further trip can break
	passedOverRunnerCountSinceLastUpdate: number;
	//how many driver loops are on the stack right now. A component mounted from post-yield code or
	//from a cleanup drives a second loop while the generator that reached it is still parked
	//mid-step, and that generator must not see the queue drain under it
	generatorCountOnStack: number;
}

const createUpdateScheduler = (): UpdateScheduler => ({
	queuedRunners: new Set(),
	runnerCurrentlyPainting: null,
	passNumber: 0,
	isPassScheduled: false,
	isPassRunning: false,
	passedOverRunnerCountSinceLastUpdate: 0,
	generatorCountOnStack: 0,
});

//one for the page: a parent updates before its child only when both drain from the same queue
const scheduler = createUpdateScheduler();

const UPDATES_PER_RUNNER_IN_ONE_PASS_LIMIT = 100;
const STEPS_PER_DRIVER_LOOP_LIMIT = 10_000;

//the pass number starts at 0 and only grows
const NEVER_UPDATED_IN_PASS = -1;

const RUNAWAY_UPDATE_MESSAGE = libraryMessage(
	"a component updated too often in one pass. An update is writing a value that schedules it again: move that write out of the update generator, or write only when the value differs",
);

const WAITING_FOR_EACH_OTHER_MESSAGE = libraryMessage(
	"components are waiting for each other to update. One of them writes into a component that writes back into it: let only one of them write to the other",
);

const ENDLESS_SYNCHRONOUS_STEPS_MESSAGE = libraryMessage(
	`a generator took ${STEPS_PER_DRIVER_LOOP_LIMIT} steps without waiting. Yield a promise to wait between steps`,
);

const UPDATE_GENERATOR_INSIDE_UPDATE_GENERATOR_MESSAGE = libraryMessage(
	"an update generator may not yield another update generator. One level of nesting only: split it with `yield*` into plain helper generators",
);

const YIELDED_VALUE_MESSAGE = libraryMessage(
	"a component yields a template, an update generator or a promise. Write `yield html`…``, `yield function* () { … }` or `yield promise`, and yield each promise instead of awaiting it",
);

export const alreadySettled = Promise.resolve();

export const createComponentRunner = (
	setup: ComponentRunnerSetup,
): ComponentRunner => {
	const runner: ComponentRunner = {
		...setup,
		blockedByRunner: null,
		bodyRun: null,
		currentUpdateGenerator: null,
		updateGeneratorRun: null,
		pendingUpdate: null,
		wasMountedOnServer: false,
		hasEndedWithFatalError: false,
		lastUpdatedInPassNumber: NEVER_UPDATED_IN_PASS,
		updateCountInPass: 0,
		ancestorRunner: null,
		lastAncestorSearchAtHostRegistrationCount: NEVER_SEARCHED,
	};
	registerRunnerForHost(runner);
	return runner;
};

const runScheduledPass = (): void => {
	scheduler.isPassScheduled = false;
	runOnePass();
};

const enqueue = (runner: ComponentRunner): void => {
	const painter = scheduler.runnerCurrentlyPainting;
	//an update from outside a paint says nothing about order, so it may not erase what a paint said
	if (painter !== null)
		runner.blockedByRunner = painter === runner ? null : painter;
	scheduler.queuedRunners.add(runner);
	const needsPass = !scheduler.isPassScheduled && !scheduler.isPassRunning;
	if (!needsPass) return;
	scheduler.isPassScheduled = true;
	queueMicrotask(runScheduledPass);
};

//the queue drains in a later microtask than the one that filled it, so the phase a runner was
//queued in can be gone by the time it is taken out
const updateQueuedRunner = (runner: ComponentRunner): void => {
	//an edge that outlived its update would block a later one, and holding the causer pins its host
	runner.blockedByRunner = null;
	const phase = phaseOf(runner);
	switch (phase) {
		//dropped rather than deferred: the mark is back on, or the host left the document. The mark
		//comes off with a START of its own, and a removal settles any pending update() through the
		//STOP that follows it
		case RUNNER_PHASE.NOT_CONNECTED:
		case RUNNER_PHASE.ENDED_BY_FATAL_ERROR:
		case RUNNER_PHASE.WAITING_FOR_PARENT_VALUES:
			return;
		case RUNNER_PHASE.READY_TO_START:
		case RUNNER_PHASE.RUNNING:
			break;
		default:
			return phase satisfies never;
	}
	//passing a runner over costs nothing but a trip round the queue, so only an update that
	//happened counts against the limit. A chain of a thousand components is deep, not runaway
	if (runner.lastUpdatedInPassNumber !== scheduler.passNumber) {
		runner.lastUpdatedInPassNumber = scheduler.passNumber;
		runner.updateCountInPass = 0;
	}
	runner.updateCountInPass++;
	if (runner.updateCountInPass > UPDATES_PER_RUNNER_IN_ONE_PASS_LIMIT) {
		endRunnerWithFatalError(runner, new Error(RUNAWAY_UPDATE_MESSAGE));
		return;
	}
	if (phase === RUNNER_PHASE.READY_TO_START) mountComponentGenerator(runner);
	else rerunCurrentUpdateGenerator(runner);
};

//a re-add moves a runner to the back, so it updates only after everything it follows. A full pass
//with nothing updated means runners wait on each other, so the one under the cursor ends visibly
const requeueBehindBlockers = (runner: ComponentRunner): void => {
	scheduler.queuedRunners.add(runner);
	scheduler.passedOverRunnerCountSinceLastUpdate++;
	const everyQueuedRunnerHasBeenPassedOver =
		scheduler.passedOverRunnerCountSinceLastUpdate >
		scheduler.queuedRunners.size;
	if (!everyQueuedRunnerHasBeenPassedOver) return;
	scheduler.passedOverRunnerCountSinceLastUpdate = 0;
	endRunnerWithFatalError(runner, new Error(WAITING_FOR_EACH_OTHER_MESSAGE));
};

const runOnePass = (): void => {
	scheduler.isPassRunning = true;
	scheduler.passNumber++;
	scheduler.passedOverRunnerCountSinceLastUpdate = 0;
	try {
		for (const runner of scheduler.queuedRunners) {
			scheduler.queuedRunners.delete(runner);
			//the causal edge is exact, so where a paint asked for this update there is nothing to infer
			const isBlockedByQueuedRunner =
				runner.blockedByRunner === null
					? hasQueuedAncestorRunner(runner, scheduler.queuedRunners)
					: scheduler.queuedRunners.has(runner.blockedByRunner);
			if (isBlockedByQueuedRunner) {
				requeueBehindBlockers(runner);
				continue;
			}
			scheduler.passedOverRunnerCountSinceLastUpdate = 0;
			updateQueuedRunner(runner);
		}
	} finally {
		scheduler.isPassRunning = false;
		const needsAnotherPass =
			!scheduler.isPassScheduled && scheduler.queuedRunners.size > 0;
		if (needsAnotherPass) {
			scheduler.isPassScheduled = true;
			queueMicrotask(runScheduledPass);
		}
	}
};

//derived, never stored: every field it reads is written by the driver itself, so a stored phase
//would be a second source of truth to keep in step
const RUNNER_PHASE = {
	NOT_CONNECTED: 140,
	WAITING_FOR_PARENT_VALUES: 141,
	READY_TO_START: 142,
	RUNNING: 143,
	ENDED_BY_FATAL_ERROR: 144,
} as const;

//spelled, not numbered: RUNNER_PHASE covers the same small integers, and a phase handed to
//sendRunnerRequest would otherwise typecheck as some other request
export const RUNNER_REQUEST = {
	START: "start",
	STOP: "stop",
	DISCONNECT: "disconnect",
	UPDATE: "update",
} as const;

const phaseOf = (runner: ComponentRunner): ValueOf<typeof RUNNER_PHASE> => {
	//ahead of the body run, because disconnectedCallback is a microtask behind the removal: between
	//the two a runner still holds everything RUNNING reads, and its host is already nowhere
	if (!runner.root.host.isConnected) return RUNNER_PHASE.NOT_CONNECTED;
	//a fatal error can land before the first START, from a prop that throws on a detached element,
	//and that START must not paint over it
	if (runner.hasEndedWithFatalError) return RUNNER_PHASE.ENDED_BY_FATAL_ERROR;
	if (runner.bodyRun !== null) return RUNNER_PHASE.RUNNING;
	//the server writes the mark while the child sits in the parent's detached fragment, so it is
	//already present when that fragment is connected and the child would otherwise paint its own run
	return !isServer() && runner.root.host.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)
		? RUNNER_PHASE.WAITING_FOR_PARENT_VALUES
		: RUNNER_PHASE.READY_TO_START;
};

//the one entry into a runner's timing: a call site reports what happened to it, the phase decides
//whether that does anything
export const sendRunnerRequest = (
	runner: ComponentRunner,
	request: ValueOf<typeof RUNNER_REQUEST>,
): Promise<void> => {
	switch (request) {
		case RUNNER_REQUEST.START:
			if (phaseOf(runner) === RUNNER_PHASE.READY_TO_START) {
				//a top-level mount stays synchronous; one inside a paint joins that paint
				if (scheduler.runnerCurrentlyPainting === null)
					mountComponentGenerator(runner);
				else enqueue(runner);
			}
			return alreadySettled;
		//the one request the phase cannot answer: a host that is gone reads NOT_CONNECTED whether or
		//not it left a run, a queue entry and an unsettled update() behind, and all three go
		case RUNNER_REQUEST.STOP:
			stopRunner(runner);
			return alreadySettled;
		//synchronous, unlike STOP: a removal and re-insertion in one task never reaches STOP, and the
		//re-insertion is the one way back from a fatal error
		case RUNNER_REQUEST.DISCONNECT:
			runner.hasEndedWithFatalError = false;
			//a move is a removal before an insertion, and it can put the causer below this runner
			runner.blockedByRunner = null;
			return alreadySettled;
		case RUNNER_REQUEST.UPDATE: {
			const hasUpdateGeneratorToRerun =
				phaseOf(runner) === RUNNER_PHASE.RUNNING &&
				runner.currentUpdateGenerator !== null;
			if (!hasUpdateGeneratorToRerun) return alreadySettled;
			runner.pendingUpdate ??= Promise.withResolvers<void>();
			enqueue(runner);
			return runner.pendingUpdate.promise;
		}
		default:
			return request satisfies never;
	}
};

const resolvePendingUpdate = (runner: ComponentRunner): void => {
	const pendingUpdate = runner.pendingUpdate;
	runner.pendingUpdate = null;
	pendingUpdate?.resolve();
};

//every field is cleared before either cleanup runs: a cleanup is user code that can call update() or
//read the host, and it has to find a runner that is already fully stopped
const stopRunner = (runner: ComponentRunner): void => {
	scheduler.queuedRunners.delete(runner);
	forgetAncestorRunner(runner);
	runner.blockedByRunner = null;
	const bodyRun = runner.bodyRun;
	const updateGeneratorRun = runner.updateGeneratorRun;
	runner.bodyRun = null;
	runner.updateGeneratorRun = null;
	runner.currentUpdateGenerator = null;
	if (updateGeneratorRun !== null) tearDownRun(updateGeneratorRun);
	if (bodyRun !== null) tearDownRun(bodyRun);
	resolvePendingUpdate(runner);
};

export const endRunnerWithFatalError = (
	runner: ComponentRunner,
	error: unknown,
): void => {
	stopRunner(runner);
	runner.hasEndedWithFatalError = true;
	displayFatalErrorInRoot(runner.root, error);
};

const settleRunner = (runner: ComponentRunner): void => {
	const queuedUpdateWillCompleteRunner = scheduler.queuedRunners.has(runner);
	if (runner.wasMountedOnServer) {
		if (!queuedUpdateWillCompleteRunner) stopRunner(runner);
		return;
	}
	if (queuedUpdateWillCompleteRunner) return;
	resolvePendingUpdate(runner);
};

const tearDownUpdateGeneratorRun = (runner: ComponentRunner): void => {
	const updateGeneratorRun = runner.updateGeneratorRun;
	if (updateGeneratorRun === null) return;
	runner.updateGeneratorRun = null;
	tearDownRun(updateGeneratorRun);
};

const dropCurrentUpdateGenerator = (runner: ComponentRunner): void => {
	runner.currentUpdateGenerator = null;
	scheduler.queuedRunners.delete(runner);
	runner.blockedByRunner = null;
	tearDownUpdateGeneratorRun(runner);
	resolvePendingUpdate(runner);
};

const mountComponentGenerator = (runner: ComponentRunner): void => {
	//a START queued by a paint can be beaten here by a move, and left in the queue it would re-run
	//the update generator this mount starts
	scheduler.queuedRunners.delete(runner);
	runner.blockedByRunner = null;
	runner.wasMountedOnServer = isServer();
	const bodyRun = createRun(
		runner,
		runner.componentGenerator(runner.componentProps),
	);
	runner.bodyRun = bodyRun;
	driveRun(bodyRun, RESUME.SEND, undefined);
};

const rerunCurrentUpdateGenerator = (runner: ComponentRunner): void => {
	const bodyRun = runner.bodyRun;
	assertDuringDevelopment(
		bodyRun !== null && runner.currentUpdateGenerator !== null,
		"a running component is queued only while it has an update generator to re-run",
	);
	driveRun(bodyRun, RESUME.START_UPDATE_GENERATOR, undefined);
};

//how the loop resumes the run it holds
const RESUME = {
	SEND: 150,
	THROW: 151,
	//the run held is the body's, parked at the yield that made runner.currentUpdateGenerator
	START_UPDATE_GENERATOR: 152,
} as const;

type ResumeKind = ValueOf<typeof RESUME>;

const NO_CATCHER: unique symbol = Symbol("no catcher");

const driveRun = (run: Run, resume: ResumeKind, payload: unknown): void => {
	scheduler.generatorCountOnStack++;
	try {
		driveRunUntilItStops(run, resume, payload);
	} finally {
		scheduler.generatorCountOnStack--;
		//a queued runner updates when no generator is left on the stack, so a pass either is already
		//running and will reach it, or starts here and now
		const mayUpdateWhatIsQueued =
			scheduler.generatorCountOnStack === 0 &&
			!scheduler.isPassRunning &&
			scheduler.queuedRunners.size > 0;
		if (mayUpdateWhatIsQueued) runOnePass();
	}
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

//only the body can catch an update generator's error, and only while it still waits at the yield
//that made it current: anything else ends the component
const catcherOf = (run: Run): Run | typeof NO_CATCHER => {
	const bodyRun = run.runner.bodyRun;
	const noGeneratorCanCatchIt =
		run === bodyRun ||
		bodyRun === null ||
		!isParkedAtTemplateOrUpdateGeneratorYield(bodyRun);
	return noGeneratorCanCatchIt ? NO_CATCHER : bodyRun;
};

//one turn is one step of one generator; every write stays in this loop, so the turn reads top to
//bottom: step, then what the step produced
const driveRunUntilItStops = (
	startRun: Run,
	startResume: ResumeKind,
	startPayload: unknown,
): void => {
	const runner = startRun.runner;
	let run = startRun;
	let resume = startResume;
	let payload = startPayload;
	for (let step = 0; step < STEPS_PER_DRIVER_LOOP_LIMIT; step++) {
		try {
			if (resume === RESUME.START_UPDATE_GENERATOR) {
				const updateGenerator = runner.currentUpdateGenerator;
				assertDuringDevelopment(
					updateGenerator !== null,
					"an update generator starts only once the body has made it the current one",
				);
				tearDownUpdateGeneratorRun(runner);
				const updateGeneratorRun = createRun(
					runner,
					updateGenerator(runner.componentProps),
				);
				runner.updateGeneratorRun = updateGeneratorRun;
				run = updateGeneratorRun;
				payload = undefined;
			}
			run.suspension = null;
			const result =
				resume === RESUME.THROW
					? run.generator.throw(payload)
					: run.generator.next(payload);
			resume = RESUME.SEND;
			const bodyRun = runner.bodyRun;
			if (result.done && run === bodyRun) {
				run.cleanup = cleanupOf(result.value);
				settleRunner(runner);
				return;
			}
			if (result.done) {
				//the body waits at its yield for the first run that finishes, and that run's return value is
				//what the yield evaluates to, unless it is the run's cleanup
				const hasReturnedCleanup = typeof result.value === "function";
				//the type layer holds a returned function to Cleanup
				if (hasReturnedCleanup) run.cleanup = result.value as Cleanup;
				const bodyIsWaitingForThisRun =
					bodyRun !== null &&
					runner.updateGeneratorRun === run &&
					isParkedAtTemplateOrUpdateGeneratorYield(bodyRun);
				settleRunner(runner);
				const bodyMayResume =
					bodyIsWaitingForThisRun && !runner.wasMountedOnServer;
				if (!bodyMayResume) return;
				run = bodyRun;
				payload = hasReturnedCleanup ? undefined : result.value;
				continue;
			}
			const yielded = result.value;
			if (yielded instanceof Promise) {
				run.suspension = yielded;
				void driveRunOnceSettled(run, yielded);
				return;
			}
			if (isGeneratorFunction(yielded)) {
				//thrown before the park, so the update generator's own catch around this yield does not take it
				if (run !== bodyRun)
					throw new Error(UPDATE_GENERATOR_INSIDE_UPDATE_GENERATOR_MESSAGE);
				run.suspension = PARKED_AT_TEMPLATE_OR_UPDATE_GENERATOR_YIELD;
				runner.currentUpdateGenerator = yielded;
				resume = RESUME.START_UPDATE_GENERATOR;
				continue;
			}
			if (!isTemplate(yielded)) throw new Error(YIELDED_VALUE_MESSAGE);
			run.suspension = PARKED_AT_TEMPLATE_OR_UPDATE_GENERATOR_YIELD;
			//a template the body yields replaces its update generator, so update() has nothing to re-run
			//until the body yields the next one
			if (run === bodyRun) dropCurrentUpdateGenerator(runner);
			const previousPainter = scheduler.runnerCurrentlyPainting;
			scheduler.runnerCurrentlyPainting = runner;
			try {
				paintComponentRoot(runner.root, yielded);
				if (runner.wasMountedOnServer) flushHostPayload(runner.root.host);
			} finally {
				scheduler.runnerCurrentlyPainting = previousPainter;
			}
			const generatorMayResumeAfterPaint =
				!runner.wasMountedOnServer &&
				isParkedAtTemplateOrUpdateGeneratorYield(run);
			if (!generatorMayResumeAfterPaint) {
				settleRunner(runner);
				return;
			}
			payload = runner.root.host;
		} catch (error) {
			if (error instanceof InvariantError) throw error;
			//a failed paint leaves its generator parked at the yield that asked for it
			const catcher = isParkedAtTemplateOrUpdateGeneratorYield(run)
				? run
				: catcherOf(run);
			run.suspension = null;
			if (catcher === NO_CATCHER) {
				endRunnerWithFatalError(runner, error);
				return;
			}
			if (catcher !== run) dropCurrentUpdateGenerator(runner);
			run = catcher;
			resume = RESUME.THROW;
			payload = error;
		}
	}
	endRunnerWithFatalError(runner, new Error(ENDLESS_SYNCHRONOUS_STEPS_MESSAGE));
};

//the async function sits outside the loop: a synchronous step never pays for the promise an async
//function allocates on every call
const driveRunOnceSettled = async (
	run: Run,
	settling: Promise<unknown>,
): Promise<void> => {
	let value: unknown;
	try {
		value = await settling;
	} catch (error) {
		if (isStillParkedAt(run, settling)) driveRun(run, RESUME.THROW, error);
		return;
	}
	if (isStillParkedAt(run, settling)) driveRun(run, RESUME.SEND, value);
};
