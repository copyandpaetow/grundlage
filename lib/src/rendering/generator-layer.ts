import { ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { paint, Painter, serverPaint } from "./painter";
import { HTMLTemplate, isTemplate } from "./template-html";

export interface GeneratorRun {
	generator: Generator | AsyncGenerator;
	finished: boolean;
	cleanup: VoidFunction | null;
	state: RenderState;
	parent: GeneratorRun | null;
}

export const createRun = (
	state: RenderState,
	generator: Generator | AsyncGenerator,
	parent: GeneratorRun | null,
): GeneratorRun => ({
	generator,
	finished: false,
	cleanup: null,
	state,
	parent,
});

export const startRun = (run: GeneratorRun): void =>
	step(run, run.generator.next(undefined));

export const cancelRun = (run: GeneratorRun): void => {
	if (!run.finished) {
		run.finished = true;
		try {
			(run.generator as Generator).return?.(undefined);
		} catch {
			//user finally threw; swallow so the rest of teardown still runs
		}
	}
	const cleanup = run.cleanup;
	if (cleanup !== null) {
		run.cleanup = null;
		cleanup();
	}
};

//a depth-1 run reached its terminal AND is still the live inner run ⇒ resolve the in-flight update().
//the outer never finishes an update; a superseded inner (no longer currentRun) is skipped
const signalRunFinished = (run: GeneratorRun): void => {
	if (run.parent !== null && run.state.currentRun === run)
		finishUpdate(run.state);
};

//report runs BEFORE signalRunFinished, so recovery has happened by the time a waiter re-evaluates its update
const failRun = (run: GeneratorRun, error: Error): void => {
	if (run.finished) return;
	run.finished = true;
	handleRendererError(run.state, error);
	signalRunFinished(run);
};

//suspends only on a real Promise; the per-await `.then` closures check run.finished before resuming,
//so a cancelled run's pending awaits go nowhere
const step = (
	run: GeneratorRun,
	next: IteratorResult<unknown> | Promise<IteratorResult<unknown>>,
): void => {
	while (true) {
		if (run.finished) return;

		if (next instanceof Promise) {
			next.then(
				(resolved) => {
					if (!run.finished) step(run, resolved);
				},
				(error) => failRun(run, error as Error),
			);
			return;
		}

		if (next.done) {
			if (typeof next.value === "function")
				run.cleanup = next.value as VoidFunction;
			run.finished = true;
			signalRunFinished(run);
			return;
		}

		if (next.value instanceof Promise) {
			next.value.then(
				(resolved) => {
					if (!run.finished) step(run, { done: false, value: resolved });
				},
				(error) => failRun(run, error as Error),
			);
			return;
		}

		let result: unknown;
		try {
			result = handleYieldedValue(run, next.value);
		} catch (error) {
			failRun(run, error as Error);
			return;
		}

		//handleYieldedValue can run user code that synchronously errors back through this run and
		//marks it finished; re-check before stepping, else .next() would shadow the real error
		if (run.finished) return;

		try {
			next = run.generator.next(result);
		} catch (error) {
			failRun(run, error as Error);
			return;
		}
	}
};

export interface RenderState {
	outerRun: GeneratorRun | null;
	currentRun: GeneratorRun | null;
	currentRenderer: ComponentGenerator | RenderFunction | null;
	pendingUpdateResolve: VoidFunction | null;
	writeToDom: (state: RenderState, value: HTMLTemplate) => void;
	painter: Painter;
}

export const writeToDom = (state: RenderState, value: HTMLTemplate): void =>
	paint(state.painter, value);

export const writeToServerDom = (
	state: RenderState,
	value: HTMLTemplate,
): void => {
	serverPaint(state.painter, value);
	if (state.currentRun !== null) cancelRun(state.currentRun);
	if (state.outerRun !== null) cancelRun(state.outerRun);
};

export const createRenderState = (
	painter: Painter,
	writer: (state: RenderState, value: HTMLTemplate) => void,
): RenderState => ({
	outerRun: null,
	currentRun: null,
	currentRenderer: null,
	pendingUpdateResolve: null,
	writeToDom: writer,
	painter,
});

export const startOuterGenerator = (
	state: RenderState,
	createGenerator: ComponentGenerator,
): void => {
	state.outerRun = createRun(state, createGenerator(state.painter.host), null); //parent null ⇒ outer
	startRun(state.outerRun);
};

//the caller resolves any pending update separately (disconnect / abort), so an `await update()` can't hang
export const teardownRenderState = (state: RenderState): void => {
	if (state.currentRun !== null) cancelRun(state.currentRun);
	if (state.outerRun !== null) cancelRun(state.outerRun);
	state.currentRun = null;
	state.outerRun = null;
	state.currentRenderer = null;
};

//idempotent: nulls the resolver before calling it, so a re-entrant terminal path can call it twice safely
export const finishUpdate = (state: RenderState): void => {
	const resolve = state.pendingUpdateResolve;
	if (resolve === null) return; //settle outside an update window (e.g. the initial connect) is ignored
	state.pendingUpdateResolve = null;
	resolve();
};

//isOuter gates the depth-specific acts (stop the inner run, record the restart recipe, allow a nested
//generator); state.writeToDom(...) is the only mode-specific spot
const handleYieldedValue = (run: GeneratorRun, value: unknown): unknown => {
	const state = run.state;
	const host = state.painter.host;
	const isOuter = run.parent === null;

	if (isTemplate(value)) {
		if (isOuter) {
			stopInnerGenerator(state);
			state.currentRenderer = null; //static: update() is a no-op
		}
		state.writeToDom(state, value);
		return host;
	}

	if (typeof value === "function") {
		if (isGeneratorFunction(value)) {
			if (!isOuter)
				throw new Error("Inner generators cannot yield generator functions");
			stopInnerGenerator(state);
			state.currentRenderer = value as ComponentGenerator;
			startInnerGenerator(state, run, value as ComponentGenerator);
			return host;
		}
		if (isOuter) {
			stopInnerGenerator(state);
			state.currentRenderer = value as RenderFunction; //re-callable on update()
		}
		state.writeToDom(state, (value as RenderFunction)(host));
		return host;
	}

	return value; //plain value flows back as the yield result
};

//parent is the outer, so the inner's errors bubble there
const startInnerGenerator = (
	state: RenderState,
	parent: GeneratorRun,
	createGenerator: ComponentGenerator,
): void => {
	state.currentRun = createRun(
		state,
		createGenerator(state.painter.host),
		parent,
	);
	startRun(state.currentRun);
};

const stopInnerGenerator = (state: RenderState): void => {
	if (state.currentRun !== null) {
		cancelRun(state.currentRun);
		state.currentRun = null;
	}
};

//inject an error into the outer generator for try/catch recovery. if it escapes, failRun reports it.
//always the outer: an inner error bubbles up here, and the outer has no parent to offer to
export const offerErrorToOuterGenerator = (
	state: RenderState,
	error: Error,
): void => {
	const run = state.outerRun;
	if (run === null || run.finished) return;
	let next: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		next = (run.generator as Generator).throw!(error);
	} catch (uncaught) {
		failRun(run, uncaught as Error);
		return;
	}
	step(run, next);
};

/*
bubble an inner error to the outer for recovery, or abort at the top. state-first so a synchronous
render-fn throw (no live run) routes here too.

the early all-null return guards the re-entrant terminal path: inner error → offer to outer → outer
rethrows → failRun(outer) → here AGAIN. without it a post-teardown re-entry would warn twice.
*/
export const handleRendererError = (state: RenderState, error: Error): void => {
	if (
		state.outerRun === null &&
		state.currentRun === null &&
		state.currentRenderer === null
	) {
		finishUpdate(state); //already torn down; just unstick any awaiting update
		return;
	}

	const outer = state.outerRun;
	if (outer === null || outer.finished) {
		abort(state, error); //outer error, or an inner whose outer is already gone; resolves update itself
		return;
	}

	const previousInner = state.currentRun;
	offerErrorToOuterGenerator(state, error); //resume the outer inside its try; it may recover by yielding
	if (outer.finished) {
		//outer caught + returned / fell through. drop the dead layers; rendered DOM stays put
		cancelRun(outer);
		if (state.outerRun === outer) state.outerRun = null;
		if (state.currentRun === previousInner) {
			stopInnerGenerator(state);
			state.currentRenderer = null;
		}
	}
	//recovery left no live inner ⇒ this call's DOM has landed, finish the update (a new generator
	//current finishes on its own via signalRunFinished, so don't double-resolve here)
	if (state.currentRun === null) finishUpdate(state);
};

const abort = (state: RenderState, error: Error): void => {
	const host = state.painter.host;
	teardownRenderState(state);
	finishUpdate(state);
	console.warn(error);
	host.shadowRoot!.textContent = `${error}`;
};

//re-run the current renderer and RETURN a Promise that resolves once this dispatch settles. that
//returned promise IS the upward signal — RenderState never references the scheduler
export const rerunCurrentRenderer = (state: RenderState): Promise<void> =>
	new Promise<void>((resolve) => {
		state.pendingUpdateResolve = resolve;
		const renderer = state.currentRenderer;
		if (renderer === null) {
			finishUpdate(state);
			return;
		}
		if (state.currentRun !== null) {
			cancelRun(state.currentRun);
			startInnerGenerator(
				state,
				state.outerRun!,
				renderer as ComponentGenerator,
			);
		} else {
			paint(state.painter, (renderer as RenderFunction)(state.painter.host));
			finishUpdate(state);
		}
	});
