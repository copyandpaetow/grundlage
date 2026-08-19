import {
	BaseComponent,
	ComponentGenerator,
	ComponentProps,
	ContentValue,
	RenderFunction,
} from "../types";
import { isGeneratorFunction, isServer } from "../utils/guards";
import {
	cancelTaskAndRunCleanup,
	classifyRenderResultAsOperation,
	createRenderTask,
	DriverStep,
	endTaskWithError,
	InstallFromRenderResultOperation,
	InstallFromYieldOperation,
	isParkedAtARenderableYield,
	isStillParkedAt,
	MODE,
	OPERATION,
	PaintFromRenderResultOperation,
	PaintFromYieldOperation,
	RELEASE_CONTROL,
	RenderOperation,
	stepTaskToNextOperation,
	Task,
} from "./task";

//the two effects the coroutine cannot perform itself, because both reach private element state.
//paint signals failure by throwing, which is the channel the loop already routes back into the
//generator
export interface RenderRunSetup {
	host: BaseComponent;
	componentProps: ComponentProps;
	componentGenerator: ComponentGenerator;
	paint: (value: ContentValue) => void;
	displayFatalError: (error: unknown) => void;
}

export interface RenderRun extends RenderRunSetup {
	componentGeneratorTask: Task | null;
	nestedGeneratorTask: Task | null;
	currentRenderable: RenderFunction | ComponentGenerator | null;
	currentRenderCallPermit: object | null;
	isScheduled: boolean;
	pendingUpdate: PromiseWithResolvers<void> | null;
	isServerRun: boolean;
}

export const createRenderRun = (setup: RenderRunSetup): RenderRun => ({
	...setup,
	componentGeneratorTask: null,
	nestedGeneratorTask: null,
	currentRenderable: null,
	currentRenderCallPermit: null,
	isScheduled: false,
	pendingUpdate: null,
	isServerRun: false,
});

export const hasStarted = (run: RenderRun): boolean =>
	run.componentGeneratorTask !== null;

export const canRerender = (run: RenderRun): boolean =>
	run.componentGeneratorTask !== null && run.currentRenderable !== null;

const resolvePendingUpdatePromise = (run: RenderRun): void => {
	const updatePromise = run.pendingUpdate;
	if (updatePromise === null) return;
	run.pendingUpdate = null;
	updatePromise.resolve();
};

export const cancelRenderRun = (run: RenderRun): void => {
	const nestedGeneratorTask = run.nestedGeneratorTask;
	const componentGeneratorTask = run.componentGeneratorTask;
	run.nestedGeneratorTask = run.componentGeneratorTask = null;
	run.currentRenderable = null;
	run.currentRenderCallPermit = null;
	cancelTaskAndRunCleanup(nestedGeneratorTask);
	cancelTaskAndRunCleanup(componentGeneratorTask);
	resolvePendingUpdatePromise(run);
};

export const endRunWithFatalError = (run: RenderRun, error: unknown): void => {
	cancelRenderRun(run);
	run.displayFatalError(error);
};

const completeRun = (run: RenderRun): void => {
	if (run.isServerRun) return cancelRenderRun(run);
	const aQueuedUpdateWillAnswerTheAwaitInstead = run.isScheduled;
	if (aQueuedUpdateWillAnswerTheAwaitInstead) return;
	resolvePendingUpdatePromise(run);
};

const cancelNestedGeneratorTask = (run: RenderRun): void => {
	const nestedGeneratorTask = run.nestedGeneratorTask;
	if (nestedGeneratorTask === null) return;
	run.nestedGeneratorTask = null;
	run.currentRenderCallPermit = null;
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

const startRun = (run: RenderRun, task: Task): void => {
	void runTaskUntilItParksOrEnds(
		run,
		task,
		stepTaskToNextOperation(task, MODE.SEND, undefined),
	);
};

export const mountComponentGenerator = (run: RenderRun): void => {
	run.isServerRun = isServer();
	const componentGeneratorTask = createRenderTask(
		run.componentGenerator(run.componentProps),
	);
	run.componentGeneratorTask = componentGeneratorTask;
	startRun(run, componentGeneratorTask);
};

export const scheduleUpdate = (run: RenderRun): Promise<void> => {
	run.pendingUpdate ??= Promise.withResolvers<void>();
	if (!run.isScheduled) {
		run.isScheduled = true;
		queueMicrotask(() => {
			run.isScheduled = false;
			rerunCurrentRenderable(run);
		});
	}
	return run.pendingUpdate.promise;
};

const rerunCurrentRenderable = (run: RenderRun): void => {
	const componentGeneratorTask = run.componentGeneratorTask;
	const renderable = run.currentRenderable;
	if (componentGeneratorTask === null || renderable === null)
		return resolvePendingUpdatePromise(run);
	if (isGeneratorFunction(renderable)) {
		startRun(
			run,
			replaceNestedGeneratorTask(run, renderable as ComponentGenerator),
		);
		return;
	}
	void runTaskUntilItParksOrEnds(
		run,
		componentGeneratorTask,
		callRenderFunction(
			run,
			componentGeneratorTask,
			renderable as RenderFunction,
		),
	);
};

const paintAndContinue = (
	run: RenderRun,
	task: Task,
	operation: PaintFromYieldOperation | PaintFromRenderResultOperation,
): DriverStep => {
	const theTemplateWasYieldedDirectly =
		operation.kind === OPERATION.PAINT_FROM_YIELD;

	if (task === run.componentGeneratorTask) {
		cancelNestedGeneratorTask(run);
		//update() re-runs whatever sits in this slot, and a directly yielded template is a one-shot
		if (theTemplateWasYieldedDirectly) run.currentRenderable = null;
	}
	try {
		run.paint(operation.payload);
	} catch (error) {
		return endTaskWithError(task, error);
	}
	const theGeneratorMayResumeAfterThisPaint =
		!run.isServerRun &&
		(theTemplateWasYieldedDirectly || isParkedAtARenderableYield(task));
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
	operation: InstallFromYieldOperation | InstallFromRenderResultOperation,
): DriverStep => {
	const theInstallerIsTheComponentGenerator =
		task === run.componentGeneratorTask;
	if (!theInstallerIsTheComponentGenerator)
		return endTaskWithError(
			task,
			new Error(
				"grundlage: an inner generator may not install another one. One level of nesting only",
			),
		);

	if (operation.kind === OPERATION.INSTALL_FROM_YIELD)
		run.currentRenderable = operation.payload;

	const theComponentGeneratorMayResumeOnceTheNestedOneParks =
		!run.isServerRun && isParkedAtARenderableYield(task);
	const componentGeneratorResumePermit =
		theComponentGeneratorMayResumeOnceTheNestedOneParks
			? task.suspension
			: null;

	startRun(run, replaceNestedGeneratorTask(run, operation.payload));
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

const runTaskUntilItParksOrEnds = async (
	run: RenderRun,
	startTask: Task,
	startStep: DriverStep,
): Promise<void> => {
	let task = startTask;
	let next = startStep;

	while (true) {
		switch (next.kind) {
			//the next step is not known yet — awaiting it is the only place this loop waits
			case OPERATION.DEFERRED:
				next = await next.payload;
				break;

			//stop: the task is waiting on something else now, or a newer render replaced this one
			case RELEASE_CONTROL.kind:
				return;

			case OPERATION.PAINT_FROM_YIELD:
			case OPERATION.PAINT_FROM_RENDER_RESULT:
				next = paintAndContinue(run, task, next);
				break;

			//the generator yielded a render function: calling it produces the next step which can be a
			//template to paint, a nested generator, a promise to wait on, or an error
			case OPERATION.CALL_RENDER_FUNCTION:
				next = callRenderFunction(run, task, next.payload);
				break;

			case OPERATION.INSTALL_FROM_YIELD:
			case OPERATION.INSTALL_FROM_RENDER_RESULT:
				next = installNestedGenerator(run, task, next);
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
				return completeRun(run);

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
};

const callRenderFunction = (
	run: RenderRun,
	task: Task,
	renderFunction: RenderFunction,
): DriverStep => {
	if (task === run.componentGeneratorTask)
		run.currentRenderable = renderFunction;
	const renderCallPermit = (run.currentRenderCallPermit = {});
	let produced: unknown;
	try {
		produced = renderFunction(run.componentProps);
	} catch (error) {
		return endTaskWithError(task, error);
	}
	return deferRenderResultIfPromised(
		run,
		task,
		classifyRenderResultAsOperation(task, produced),
		renderCallPermit,
	);
};

//a render result is classified, not executed: everything but the await is an operation the loop
//already knows how to run
const deferRenderResultIfPromised = (
	run: RenderRun,
	task: Task,
	operation: RenderOperation,
	renderCallPermit: object,
): DriverStep =>
	operation.kind === OPERATION.AWAIT_RENDER_RESULT
		? {
				kind: OPERATION.DEFERRED,
				payload: settleRenderResult(
					run,
					task,
					operation.payload,
					renderCallPermit,
				),
			}
		: operation;

const settleRenderResult = async (
	run: RenderRun,
	task: Task,
	promise: Promise<unknown>,
	renderCallPermit: object,
): Promise<DriverStep> => {
	let value: unknown;
	try {
		value = await promise;
	} catch (error) {
		return run.currentRenderCallPermit === renderCallPermit
			? endTaskWithError(task, error)
			: RELEASE_CONTROL;
	}
	if (run.currentRenderCallPermit !== renderCallPermit) return RELEASE_CONTROL;

	return deferRenderResultIfPromised(
		run,
		task,
		classifyRenderResultAsOperation(task, value),
		renderCallPermit,
	);
};
