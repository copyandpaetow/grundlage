import { ValueOf } from "../parser/types";
import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
import { Painter, teardownPainter } from "./painter";
import {
	createRenderTask,
	createStepOutcome,
	ROLE,
	STEP_OUTCOME,
	StepOutcome,
	Task,
} from "./task";

export interface Engine {
	readonly host: BaseComponent;
	readonly componentGenerator: ComponentGenerator;
	painter: Painter;
	outer: Task | null;
	inner: Task | null;
	renderer: ComponentGenerator | RenderFunction | null;
	scheduled: boolean;
	pendingUpdate: PromiseWithResolvers<void> | null;
}

export const createEngine = (
	host: BaseComponent,
	painter: Painter,
	componentGenerator: ComponentGenerator,
): Engine => ({
	host,
	componentGenerator,
	painter,
	outer: null,
	inner: null,
	renderer: null,
	scheduled: false,
	pendingUpdate: null,
});

export const MODE = { SEND: 0, THROW: 1 } as const;

export type SteppedTask = StepOutcome | Promise<IteratorResult<unknown>>;

export const isTaskLive = (engine: Engine, task: Task): boolean =>
	(task.role === ROLE.INNER ? engine.inner : engine.outer) === task;

export const resetInnerTask = (
	engine: Engine,
	source: ComponentGenerator,
): Task => {
	cancelTaskAndRunCleanup(engine.inner);
	const inner = createRenderTask(ROLE.INNER, source(engine.host));
	engine.inner = inner;
	return inner;
};

export const cancelTaskAndRunCleanup = (task: Task | null): void => {
	if (task === null) return;
	let ending: unknown;
	try {
		ending = task.generator.return?.(undefined);
	} catch {
		/* a generator that throws on return() is already dead; nothing left to salvage */
	}
	// the engine is being torn down, so there is no live onError channel to route to
	if (ending instanceof Promise) ending.catch(console.warn);
	const cleanup = task.cleanup;
	if (cleanup !== null) {
		task.cleanup = null;
		cleanup();
	}
};

export const cancelBothTasks = (engine: Engine): void => {
	const { inner, outer } = engine;
	engine.inner = engine.outer = engine.renderer = null;
	cancelTaskAndRunCleanup(inner);
	cancelTaskAndRunCleanup(outer);
};

export const createCleanStepOutcome = (
	result: IteratorResult<unknown>,
): StepOutcome =>
	result.done
		? createStepOutcome(STEP_OUTCOME.RETURNED, result.value)
		: createStepOutcome(STEP_OUTCOME.YIELDED, result.value);

export const nextTaskStep = (
	task: Task,
	mode: ValueOf<typeof MODE>,
	value: unknown,
): SteppedTask => {
	let stepped: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		stepped =
			mode === MODE.THROW
				? (task.generator as Generator).throw!(value)
				: task.generator.next(value);
	} catch (error) {
		return createStepOutcome(STEP_OUTCOME.THREW, error);
	}
	return stepped instanceof Promise ? stepped : createCleanStepOutcome(stepped);
};

const writeFatalErrorIntoShadow = (painter: Painter, error: unknown): void => {
	console.warn(error);
	painter.shadowRoot.textContent = `${error}`;
	// the error text replaces the DOM these referenced; a reconnect must remount, not
	// patch the now-detached instance in place (same-hash reconcile would stay stuck)
	painter.instance = null;
	painter.hostBindingCount = 0;
};

export const cancelEngineAndNotifyHost = (
	engine: Engine,
	error: unknown,
): void => {
	cancelBothTasks(engine);
	//release the attribute observer here: disconnect() nulls engine.outer, so the
	//disconnectedCallback guard would otherwise skip stopEngine and leak it forever
	teardownPainter(engine.painter);
	writeFatalErrorIntoShadow(engine.painter, error);
	resolvePendingUpdatePromise(engine);
};

export const resolvePendingUpdatePromise = (engine: Engine): void => {
	const updatePromise = engine.pendingUpdate;
	if (updatePromise === null) return;
	engine.pendingUpdate = null;
	updatePromise.resolve();
};
