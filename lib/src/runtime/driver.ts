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
import { flushHostPayload, LOAD_REQUEST, RecordedLoad } from "../load";
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
	isGeneratorObject,
	isStillParkedAt,
	isWaitingForUpdateGeneratorRun,
	Run,
	tearDownRun,
	WAITING_FOR_UPDATE_GENERATOR_RUN,
} from "./run";
import { isTemplate, TemplateValue } from "../template";
import { ComponentRenderEvent } from "./component-render-event";
import { PendingTaskEvent } from "./pending-task-event";
import {
	assertDuringDevelopment,
	InvariantError,
	isDevelopmentBuild,
	libraryMessage,
	reportErrorFromUserCode,
	warnDuringDevelopment,
} from "../utils/diagnostics";
import * as RUNNER_REQUEST from "./runner-request";
import * as RUNNER_PHASE from "./runner-phase";
import * as TURN from "./driver-turn";

interface ComponentRunnerSetup {
	root: ComponentRoot;
	componentProps: ComponentProps;
	componentGenerator: ComponentGenerator;
	requiredPropNames: ReadonlyArray<string>;
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
	loadsRecordedOnServer: Array<RecordedLoad>;
	hasEndedWithFatalError: boolean;
	//a fatal error that lands while a loop drives the runner waits for that loop to let go, so no
	//teardown and no error display runs in the middle of a step, a paint or a teardown
	pendingFatalError: unknown;
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

//pendingFatalError while no loop drives the runner, so a fatal error ends it at once
const NOT_DRIVEN: unique symbol = Symbol("not driven");
const NO_PENDING_FATAL_ERROR: unique symbol = Symbol("no pending fatal error");

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
	"a component yields a template, an update generator, a promise or a load(). Write `yield html`…``, `yield function* () { … }`, `yield promise` or `yield* load(() => …)`, and yield each promise instead of awaiting it",
);

const DROPPED_BODY_RETURN_MESSAGE =
	"the generator returned a value that is not a function, so it was dropped. The return position is the cleanup function.";

const YIELDED_GENERATOR_OBJECT_MESSAGE = libraryMessage(
	"a component yielded a generator object. To run a helper generator, add the star: `yield* helper(…)`. To declare an update generator, yield the function without calling it: `yield view`",
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
		loadsRecordedOnServer: [],
		hasEndedWithFatalError: false,
		pendingFatalError: NOT_DRIVEN,
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
	//an update from outside a paint says nothing about order, so it may not erase what a paint said
	if (scheduler.runnerCurrentlyPainting !== null)
		runner.blockedByRunner =
			scheduler.runnerCurrentlyPainting === runner
				? null
				: scheduler.runnerCurrentlyPainting;
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

const isMissingRequiredProp = (runner: ComponentRunner): boolean => {
	//the props object has no index signature; a required prop is read by its runtime name
	const values = runner.componentProps as unknown as Record<string, unknown>;
	for (let index = 0; index < runner.requiredPropNames.length; index++)
		if (values[runner.requiredPropNames[index]] === undefined) return true;
	return false;
};

//derived, never stored: every field it reads is written by the driver itself, so a stored phase
//would be a second source of truth to keep in step
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
	//a required prop that has not arrived holds the start the same way a parent's mark does
	if (isMissingRequiredProp(runner))
		return RUNNER_PHASE.WAITING_FOR_PARENT_VALUES;
	return !isServer() && runner.root.host.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)
		? RUNNER_PHASE.WAITING_FOR_PARENT_VALUES
		: RUNNER_PHASE.READY_TO_START;
};

//the fields a phase is derived from constrain each other; checked wherever user code can be watching
const assertRunnerIsConsistent = (runner: ComponentRunner): void => {
	const isQueued = scheduler.queuedRunners.has(runner);
	assertDuringDevelopment(
		runner.blockedByRunner === null || isQueued,
		"a runner waits for another only while it is queued",
	);
	assertDuringDevelopment(
		runner.bodyRun !== null ||
			(runner.currentUpdateGenerator === null &&
				runner.updateGeneratorRun === null),
		"an update generator belongs to a running body",
	);
	assertDuringDevelopment(
		runner.updateGeneratorRun === null ||
			runner.currentUpdateGenerator !== null,
		"an update generator run belongs to the current update generator",
	);
	assertDuringDevelopment(
		!runner.hasEndedWithFatalError || (runner.bodyRun === null && !isQueued),
		"a runner that ended with a fatal error holds no run and no queue entry",
	);
};

//the one entry into a runner's timing: a call site reports what happened to it, the phase decides
//whether that does anything
export const sendRunnerRequest = (
	runner: ComponentRunner,
	request: ValueOf<typeof RUNNER_REQUEST>,
): Promise<void> => {
	if (isDevelopmentBuild) assertRunnerIsConsistent(runner);
	switch (request) {
		case RUNNER_REQUEST.START: {
			if (phaseOf(runner) !== RUNNER_PHASE.READY_TO_START)
				return alreadySettled;
			const isLeftForTheBrowser =
				isServer() &&
				!runner.root.host.dispatchEvent(new ComponentRenderEvent());
			if (isLeftForTheBrowser) return alreadySettled;
			//a top-level mount stays synchronous; one inside a paint joins that paint
			if (scheduler.runnerCurrentlyPainting === null)
				mountComponentGenerator(runner);
			else enqueue(runner);
			return alreadySettled;
		}
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
	if (runner.pendingFatalError === NO_PENDING_FATAL_ERROR) {
		runner.pendingFatalError = error;
		return;
	}
	//the component is already ending, so a second error has nothing left to end
	if (runner.pendingFatalError !== NOT_DRIVEN) {
		reportErrorFromUserCode(error);
		return;
	}
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
	let bodyRun: Run;
	try {
		bodyRun = createRun(
			runner,
			//not a method call, which would hand user code the runner as this
			runner.componentGenerator.call(undefined, runner.componentProps),
		);
	} catch (error) {
		if (error instanceof InvariantError) throw error;
		endRunnerWithFatalError(runner, error);
		return;
	}
	//the body's parameter defaults run user code, which can end the component before the body starts
	if (phaseOf(runner) !== RUNNER_PHASE.READY_TO_START) return;
	runner.bodyRun = bodyRun;
	driveRun(bodyRun, TURN.SEND, undefined);
};

const rerunCurrentUpdateGenerator = (runner: ComponentRunner): void => {
	assertDuringDevelopment(
		runner.bodyRun !== null && runner.currentUpdateGenerator !== null,
		"a running component is queued only while it has an update generator to re-run",
	);
	driveRun(runner.bodyRun, TURN.START_UPDATE_GENERATOR, undefined);
};

type TurnKind = ValueOf<typeof TURN>;

const driveRun = (run: Run, turn: TurnKind, payload: unknown): void => {
	assertDuringDevelopment(
		run.runner.pendingFatalError === NOT_DRIVEN,
		"one loop at a time drives a runner",
	);
	scheduler.generatorCountOnStack++;
	run.runner.pendingFatalError = NO_PENDING_FATAL_ERROR;
	try {
		driveRunUntilItStops(run, turn, payload);
		const pendingFatalError = run.runner.pendingFatalError;
		run.runner.pendingFatalError = NOT_DRIVEN;
		if (pendingFatalError !== NO_PENDING_FATAL_ERROR)
			endRunnerWithFatalError(run.runner, pendingFatalError);
		if (isDevelopmentBuild) assertRunnerIsConsistent(run.runner);
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

//true only inside a loop: from there on the loop runs no more of the component and lets go
const hasFatalErrorWaiting = (runner: ComponentRunner): boolean =>
	runner.pendingFatalError !== NO_PENDING_FATAL_ERROR &&
	runner.pendingFatalError !== NOT_DRIVEN;

//a component this paint writes into updates after it, so the queue has to know who is painting
const paintRunnerRoot = (
	runner: ComponentRunner,
	template: TemplateValue,
): void => {
	const previousPainter = scheduler.runnerCurrentlyPainting;
	scheduler.runnerCurrentlyPainting = runner;
	try {
		paintComponentRoot(runner.root, template);
		if (runner.wasMountedOnServer)
			flushHostPayload(runner.loadsRecordedOnServer, runner.root.shadowRoot);
	} finally {
		scheduler.runnerCurrentlyPainting = previousPainter;
	}
};

//a turn does what the last step asked for, steps the run, then reads what it asks for next. Every
//call into user code is followed by the check that no fatal error is waiting
const driveRunUntilItStops = (
	run: Run,
	turn: TurnKind,
	payload: unknown,
): void => {
	for (let step = 0; step < STEPS_PER_DRIVER_LOOP_LIMIT; step++) {
		switch (turn) {
			case TURN.SEND:
			case TURN.THROW:
				break;
			case TURN.START_UPDATE_GENERATOR: {
				tearDownUpdateGeneratorRun(run.runner);
				//the last run's cleanup or finally block can end the component
				if (hasFatalErrorWaiting(run.runner)) return;
				assertDuringDevelopment(
					run.runner.currentUpdateGenerator !== null,
					"an update generator starts only once the body has made it the current one",
				);
				let updateGeneratorRun: Run;
				try {
					updateGeneratorRun = createRun(
						run.runner,
						//not a method call, which would hand user code the runner as this
						run.runner.currentUpdateGenerator.call(
							undefined,
							run.runner.componentProps,
						),
					);
				} catch (error) {
					if (error instanceof InvariantError) throw error;
					turn = TURN.FAIL;
					payload = error;
					continue;
				}
				//so can the update generator's parameter defaults
				if (hasFatalErrorWaiting(run.runner)) return;
				run.runner.updateGeneratorRun = updateGeneratorRun;
				run = updateGeneratorRun;
				turn = TURN.SEND;
				payload = undefined;
				break;
			}
			case TURN.PAINT: {
				assertDuringDevelopment(
					isTemplate(payload),
					"a paint is asked for with the template the run yielded",
				);
				//a template the body yields replaces its update generator, so update() has nothing to re-run
				//until the body yields the next one
				if (run === run.runner.bodyRun) dropCurrentUpdateGenerator(run.runner);
				//the dropped run's cleanup or finally block can end the component
				if (hasFatalErrorWaiting(run.runner)) return;
				try {
					paintRunnerRoot(run.runner, payload);
				} catch (error) {
					if (error instanceof InvariantError) throw error;
					//a failed paint is thrown at the yield that asked for it, while that run is still there
					turn = hasFatalErrorWaiting(run.runner) ? TURN.FAIL : TURN.THROW;
					payload = error;
					continue;
				}
				//a paint can end the component as well
				if (hasFatalErrorWaiting(run.runner)) return;
				//the server's run ends at its first paint
				if (run.runner.wasMountedOnServer) {
					settleRunner(run.runner);
					return;
				}
				turn = TURN.SEND;
				payload = run.runner.root.host;
				break;
			}
			case TURN.FAIL: {
				//only the body can catch an update generator's error, and only while it still waits at the
				//yield that made it current: anything else ends the component
				const bodyRun = run.runner.bodyRun;
				const bodyCatchesIt =
					bodyRun !== null && isWaitingForUpdateGeneratorRun(bodyRun);
				if (!bodyCatchesIt) {
					endRunnerWithFatalError(run.runner, payload);
					return;
				}
				dropCurrentUpdateGenerator(run.runner);
				//the dropped run's cleanup or finally block can end the component, and then the error has
				//no yield left to surface at
				if (hasFatalErrorWaiting(run.runner)) {
					reportErrorFromUserCode(payload);
					return;
				}
				run = bodyRun;
				turn = TURN.THROW;
				break;
			}
			default:
				return turn satisfies never;
		}
		run.suspension = null;
		try {
			const result =
				turn === TURN.THROW
					? run.generator.throw(payload)
					: run.generator.next(payload);
			//the type layer holds a returned function to Cleanup
			const hasReturnedCleanup =
				result.done === true && typeof result.value === "function";
			if (hasReturnedCleanup) run.cleanup = result.value as Cleanup;
			//a prop the step wrote can end the component
			if (hasFatalErrorWaiting(run.runner)) return;
			const isBodyRun = run === run.runner.bodyRun;
			if (result.done && isBodyRun) {
				//nothing downstream reads any other return, so without this the drop is invisible to
				//anyone not running the types
				if (!hasReturnedCleanup && result.value !== undefined)
					warnDuringDevelopment(DROPPED_BODY_RETURN_MESSAGE);
				settleRunner(run.runner);
				return;
			}
			if (result.done) {
				settleRunner(run.runner);
				//the server's body never goes on past the yield of an update generator
				if (run.runner.wasMountedOnServer) return;
				//the body waits at its yield for the first run that finishes, and goes on with its value
				const bodyRun = run.runner.bodyRun;
				const bodyWaitsForThisRun =
					bodyRun !== null && isWaitingForUpdateGeneratorRun(bodyRun);
				if (!bodyWaitsForThisRun) return;
				//the body's yield evaluates to the run's return value, unless that is the run's cleanup
				payload = hasReturnedCleanup ? undefined : result.value;
				run = bodyRun;
				turn = TURN.SEND;
				continue;
			}
			const yielded = result.value;
			if (yielded instanceof Promise) {
				run.suspension = yielded;
				void driveRunOnceSettled(run, yielded);
				//after the continuation is registered: a listener awaiting the task resumes only once this
				//run has gone on, so every child its next paint mounts has announced its own task by then
				if (run.runner.wasMountedOnServer)
					run.runner.root.host.dispatchEvent(new PendingTaskEvent(yielded));
				return;
			}
			if (isGeneratorFunction(yielded)) {
				//thrown before the wait, so the update generator's own catch around this yield does not take it
				if (!isBodyRun)
					throw new Error(UPDATE_GENERATOR_INSIDE_UPDATE_GENERATOR_MESSAGE);
				run.suspension = WAITING_FOR_UPDATE_GENERATOR_RUN;
				run.runner.currentUpdateGenerator = yielded;
				turn = TURN.START_UPDATE_GENERATOR;
				continue;
			}
			if (yielded === LOAD_REQUEST) {
				turn = TURN.SEND;
				payload = run.runner;
				continue;
			}
			if (isTemplate(yielded)) {
				turn = TURN.PAINT;
				payload = yielded;
				continue;
			}
			if (isGeneratorObject(yielded))
				throw new Error(YIELDED_GENERATOR_OBJECT_MESSAGE);
			throw new Error(YIELDED_VALUE_MESSAGE);
		} catch (error) {
			if (error instanceof InvariantError) throw error;
			turn = TURN.FAIL;
			payload = error;
		}
	}
	endRunnerWithFatalError(
		run.runner,
		new Error(ENDLESS_SYNCHRONOUS_STEPS_MESSAGE),
	);
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
		if (isStillParkedAt(run, settling)) driveRun(run, TURN.THROW, error);
		return;
	}
	if (isStillParkedAt(run, settling)) driveRun(run, TURN.SEND, value);
};
