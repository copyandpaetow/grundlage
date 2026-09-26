import { ValueOf } from "../utils/types";
import {
	Cleanup,
	ComponentGenerator,
	ContentValue,
	RenderFunction,
} from "../types";
import { isGeneratorFunction } from "../utils/guards";
import { isTemplate } from "../template";
import { reportErrorFromUserCode, warnDuringDevelopment } from "../utils/diagnostics";

export const OPERATION = {
	PAINT_FROM_YIELD: 0,
	PAINT_FROM_RENDER_RESULT: 1,
	INSTALL_FROM_YIELD: 2,
	INSTALL_FROM_RENDER_RESULT: 3,
	RESUME: 4,
	RESUME_WITH_ERROR: 5,
	CALL_RENDER_FUNCTION: 6,
	COMPLETED: 7,
	ROUTE_ERROR: 8,
	RELEASE_CONTROL: 9,
	DEFERRED: 10,
} as const;

export const MODE = { SEND: 0, THROW: 1 } as const;

type OperationKind = ValueOf<typeof OPERATION>;

//identity is the resume permit: a continuation may only step the task still parked on its own
export interface Suspension {
	isAtARenderableYield: boolean;
}

type GeneratorStepResult =
	IteratorResult<unknown> | Promise<IteratorResult<unknown>>;

//a union of Generator and AsyncGenerator cannot be stepped without picking one of the two call
//signatures, so the task names the shape both of them answer to
interface SteppableGenerator {
	next(value: unknown): GeneratorStepResult;
	throw(error: unknown): GeneratorStepResult;
	return?(value: unknown): unknown;
}

export interface Task {
	generator: SteppableGenerator;
	suspension: Suspension | null;
	cleanup: Cleanup | null;
}

export const createRenderTask = (generator: SteppableGenerator): Task => ({
	generator,
	suspension: null,
	cleanup: null,
});

export const isParkedAtARenderableYield = (task: Task): boolean =>
	task.suspension?.isAtARenderableYield === true;

export const isStillParkedAt = (
	task: Task,
	suspension: Suspension | null,
): boolean => suspension !== null && task.suspension === suspension;

type PaintFromYieldOperation = {
	kind: typeof OPERATION.PAINT_FROM_YIELD;
	payload: ContentValue;
};
type PaintFromRenderResultOperation = {
	kind: typeof OPERATION.PAINT_FROM_RENDER_RESULT;
	payload: ContentValue;
};

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
	| PaintFromYieldOperation
	| InstallFromYieldOperation
	| { kind: typeof OPERATION.RESUME; payload: unknown }
	| { kind: typeof OPERATION.RESUME_WITH_ERROR; payload: unknown }
	| { kind: typeof OPERATION.CALL_RENDER_FUNCTION; payload: RenderFunction }
	| { kind: typeof OPERATION.COMPLETED; payload: null }
	| DeferredOperation
	| RouteErrorOperation;

export type RenderOperation =
	| PaintFromRenderResultOperation
	| InstallFromRenderResultOperation
	| RouteErrorOperation;

//this run is over: the task parked, failed or completed, or the continuation that produced this
//found its permit revoked while it was pending
export const RELEASE_CONTROL = {
	kind: OPERATION.RELEASE_CONTROL,
	payload: null,
} as const;

export type DriverStep =
	CoroutineOperation | RenderOperation | typeof RELEASE_CONTROL;

export const createOperation = <Kind extends OperationKind, Payload>(
	kind: Kind,
	payload: Payload,
): { kind: Kind; payload: Payload } => ({ kind, payload });

const canBeCommittedAsContent = (value: unknown): value is ContentValue =>
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
	if (isGeneratorFunction(produced))
		return createOperation(OPERATION.INSTALL_FROM_RENDER_RESULT, produced);
	if (canBeCommittedAsContent(produced)) {
		//the two shapes below cannot render at all and end the run; an empty render is legal, so this
		//one warns and paints nothing
		if (produced === undefined)
			warnDuringDevelopment(
				"the render function returned undefined, so nothing was rendered. A block body needs an explicit return.",
			);
		return createOperation(OPERATION.PAINT_FROM_RENDER_RESULT, produced);
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
	if (isTemplate(value)) {
		task.suspension = { isAtARenderableYield: true };
		return createOperation(OPERATION.PAINT_FROM_YIELD, value);
	}
	if (isGeneratorFunction(value)) {
		task.suspension = { isAtARenderableYield: true };
		return createOperation(OPERATION.INSTALL_FROM_YIELD, value);
	}
	if (typeof value === "function") {
		task.suspension = { isAtARenderableYield: true };
		return createOperation(
			OPERATION.CALL_RENDER_FUNCTION,
			value as RenderFunction,
		);
	}
	if (value instanceof Promise) {
		const suspension: Suspension = { isAtARenderableYield: false };
		task.suspension = suspension;
		return createOperation(
			OPERATION.DEFERRED,
			settleYieldedPromise(task, value, suspension),
		);
	}
	//yield position is control flow, so anything that is neither a promise nor a renderable is echoed
	//back to the generator; content shapes like arrays are the return position's job
	return createOperation(OPERATION.RESUME, value);
};

export const classifySettledStepAsOperation = (
	task: Task,
	result: IteratorResult<unknown>,
): CoroutineOperation => {
	if (!result.done) return classifyYieldedValueAsOperation(task, result.value);
	const returned = result.value;
	//nothing downstream reads a non-function return, so without this the drop is invisible to
	//anyone not running the types
	if (returned !== undefined && typeof returned !== "function")
		warnDuringDevelopment(
			"the generator returned a value that is not a function, so it was dropped. The return position is the cleanup function.",
		);
	task.cleanup = typeof returned === "function" ? (returned as Cleanup) : null;
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
	if (ending instanceof Promise) ending.catch(reportErrorFromUserCode);
	const cleanup = task.cleanup;
	if (cleanup === null) return;
	task.cleanup = null;
	try {
		cleanup();
	} catch (error) {
		//a torn-down generator has no yield left to surface at, and the caller still has a sibling
		//cleanup to run and a paint to make after this, so it is reported instead of thrown
		reportErrorFromUserCode(error);
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
	let stepped: GeneratorStepResult;
	try {
		stepped =
			mode === MODE.THROW
				? task.generator.throw(value)
				: task.generator.next(value);
	} catch (error) {
		return endTaskWithError(task, error);
	}
	if (!(stepped instanceof Promise))
		return classifySettledStepAsOperation(task, stepped);
	const suspension: Suspension = { isAtARenderableYield: false };
	task.suspension = suspension;
	return createOperation(
		OPERATION.DEFERRED,
		settlePendingStep(task, stepped, suspension),
	);
};
