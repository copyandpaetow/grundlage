import { ValueOf } from "../utils/types";
import { ComponentGenerator, ContentValue, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/guards";
import { isTemplate } from "../template";

export const OPERATION = {
	PAINT: 0,
	INSTALL_FROM_YIELD: 1,
	INSTALL_FROM_RENDER_RESULT: 2,
	RESUME: 3,
	RESUME_WITH_ERROR: 4,
	CALL_RENDER_FUNCTION: 5,
	AWAIT_RENDER_RESULT: 6,
	COMPLETED: 7,
	ROUTE_ERROR: 8,
	RELEASE_CONTROL: 9,
	DEFERRED: 10,
} as const;

export const MODE = { SEND: 0, THROW: 1 } as const;

export const PARKED = {
	YIELDED_PROMISE: 0,
	YIELDED_RENDERABLE: 1,
	PENDING_STEP: 2,
} as const;

type OperationKind = ValueOf<typeof OPERATION>;

//identity is the resume permit: a continuation may only step the task still parked on its own
export interface Suspension {
	parkedAt: ValueOf<typeof PARKED>;
}

export interface Task {
	generator: Generator | AsyncGenerator;
	suspension: Suspension | null;
	cleanup: VoidFunction | null;
}

export const createRenderTask = (
	generator: Generator | AsyncGenerator,
): Task => ({
	generator,
	suspension: null,
	cleanup: null,
});

export const isParkedAtARenderableYield = (task: Task): boolean =>
	task.suspension?.parkedAt === PARKED.YIELDED_RENDERABLE;

export const isStillParkedAt = (
	task: Task,
	suspension: Suspension | null,
): boolean => suspension !== null && task.suspension === suspension;

type PaintOperation = { kind: typeof OPERATION.PAINT; payload: ContentValue };

type InstallFromYieldOperation = {
	kind: typeof OPERATION.INSTALL_FROM_YIELD;
	payload: ComponentGenerator;
};
type InstallFromRenderResultOperation = {
	kind: typeof OPERATION.INSTALL_FROM_RENDER_RESULT;
	payload: ComponentGenerator;
};
type RouteErrorOperation = {
	kind: typeof OPERATION.ROUTE_ERROR;
	payload: unknown;
};

//the one suspension shape: a promise of the next step, already guarded by the lane that built it
type DeferredOperation = {
	kind: typeof OPERATION.DEFERRED;
	payload: Promise<DriverStep>;
};

export type CoroutineOperation =
	| PaintOperation
	| InstallFromYieldOperation
	| { kind: typeof OPERATION.RESUME; payload: unknown }
	| { kind: typeof OPERATION.RESUME_WITH_ERROR; payload: unknown }
	| { kind: typeof OPERATION.CALL_RENDER_FUNCTION; payload: RenderFunction }
	| { kind: typeof OPERATION.COMPLETED; payload: null }
	| DeferredOperation
	| RouteErrorOperation;

export type RenderOperation =
	| PaintOperation
	| InstallFromRenderResultOperation
	| { kind: typeof OPERATION.AWAIT_RENDER_RESULT; payload: Promise<unknown> }
	| RouteErrorOperation;

type Operation = CoroutineOperation | RenderOperation;

//this run is over: the task parked, failed or completed, or the continuation that produced this
//found its permit revoked while it was pending
export const RELEASE_CONTROL = {
	kind: OPERATION.RELEASE_CONTROL,
	payload: null,
} as const;

export type DriverStep =
	| CoroutineOperation
	| InstallFromRenderResultOperation
	| typeof RELEASE_CONTROL;

const createOperation = <Kind extends OperationKind>(
	kind: Kind,
	payload: Extract<Operation, { kind: Kind }>["payload"],
): Extract<Operation, { kind: Kind }> =>
	({ kind, payload }) as Extract<Operation, { kind: Kind }>;

const canBeCommittedAsContent = (value: unknown): boolean =>
	value === null ||
	(typeof value !== "object" &&
		typeof value !== "function" &&
		typeof value !== "symbol") ||
	isTemplate(value) ||
	Array.isArray(value);

export const endTaskWithError = (
	task: Task,
	error: unknown,
): RouteErrorOperation => {
	task.suspension = null;
	return createOperation(OPERATION.ROUTE_ERROR, error);
};

export const classifyRenderResultAsOperation = (
	task: Task,
	produced: unknown,
): RenderOperation => {
	if (produced instanceof Promise)
		return createOperation(OPERATION.AWAIT_RENDER_RESULT, produced);
	if (isGeneratorFunction(produced))
		return createOperation(
			OPERATION.INSTALL_FROM_RENDER_RESULT,
			produced as ComponentGenerator,
		);
	if (canBeCommittedAsContent(produced)) {
		if (produced === undefined)
			console.warn(
				"grundlage: the render function returned undefined, so nothing was rendered. A block body needs an explicit return.",
			);
		return createOperation(OPERATION.PAINT, produced as ContentValue);
	}
	if (typeof produced === "function")
		return endTaskWithError(
			task,
			new Error(
				"grundlage: the render function returned a plain function. A generator function body needs the *.",
			),
		);
	return endTaskWithError(
		task,
		new Error(
			"grundlage: the render function returned a value that cannot be rendered.",
		),
	);
};

const settleYieldedPromise = async (
	task: Task,
	promise: Promise<unknown>,
	suspension: Suspension,
): Promise<DriverStep> => {
	try {
		const value = await promise;
		return isStillParkedAt(task, suspension)
			? createOperation(OPERATION.RESUME, value)
			: RELEASE_CONTROL;
	} catch (error) {
		return isStillParkedAt(task, suspension)
			? createOperation(OPERATION.RESUME_WITH_ERROR, error)
			: RELEASE_CONTROL;
	}
};

const classifyYieldedValueAsOperation = (
	task: Task,
	value: unknown,
): CoroutineOperation => {
	if (isTemplate(value)) return createOperation(OPERATION.PAINT, value);
	if (isGeneratorFunction(value)) {
		task.suspension = { parkedAt: PARKED.YIELDED_RENDERABLE };
		return createOperation(
			OPERATION.INSTALL_FROM_YIELD,
			value as ComponentGenerator,
		);
	}
	if (typeof value === "function") {
		task.suspension = { parkedAt: PARKED.YIELDED_RENDERABLE };
		return createOperation(
			OPERATION.CALL_RENDER_FUNCTION,
			value as RenderFunction,
		);
	}
	if (value instanceof Promise) {
		const suspension: Suspension = { parkedAt: PARKED.YIELDED_PROMISE };
		task.suspension = suspension;
		return createOperation(
			OPERATION.DEFERRED,
			settleYieldedPromise(task, value, suspension),
		);
	}
	return createOperation(OPERATION.RESUME, value);
};

export const classifySettledStepAsOperation = (
	task: Task,
	result: IteratorResult<unknown>,
): CoroutineOperation => {
	if (!result.done) return classifyYieldedValueAsOperation(task, result.value);
	task.cleanup =
		typeof result.value === "function" ? (result.value as VoidFunction) : null;
	return createOperation(OPERATION.COMPLETED, null);
};

export const cancelTaskAndRunCleanup = (task: Task | null): void => {
	if (task === null) return;
	task.suspension = null;
	let ending: unknown;
	try {
		ending = task.generator.return?.(undefined);
	} catch {
		/* a generator that throws on return() is already dead; nothing left to salvage */
	}
	if (ending instanceof Promise) ending.catch(console.warn);
	const cleanup = task.cleanup;
	if (cleanup) {
		task.cleanup = null;
		cleanup();
	}
};

const settlePendingStep = async (
	task: Task,
	stepped: Promise<IteratorResult<unknown>>,
	suspension: Suspension,
): Promise<DriverStep> => {
	try {
		const result = await stepped;
		return isStillParkedAt(task, suspension)
			? classifySettledStepAsOperation(task, result)
			: RELEASE_CONTROL;
	} catch (error) {
		return isStillParkedAt(task, suspension)
			? endTaskWithError(task, error)
			: RELEASE_CONTROL;
	}
};

export const stepTaskToNextOperation = (
	task: Task,
	mode: ValueOf<typeof MODE>,
	value: unknown,
): DriverStep => {
	//cleared before the call, not after: an async generator has left its yield the moment it is
	//resumed, long before the step settles, and nothing may resume it again in between
	task.suspension = null;
	let stepped: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		stepped =
			mode === MODE.THROW
				? (task.generator as Generator).throw!(value)
				: task.generator.next(value);
	} catch (error) {
		return endTaskWithError(task, error);
	}
	if (!(stepped instanceof Promise))
		return classifySettledStepAsOperation(task, stepped);
	const suspension: Suspension = { parkedAt: PARKED.PENDING_STEP };
	task.suspension = suspension;
	return createOperation(
		OPERATION.DEFERRED,
		settlePendingStep(task, stepped, suspension),
	);
};
