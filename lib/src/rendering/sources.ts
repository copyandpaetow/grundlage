import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
import { isGeneratorFunction } from "../utils/is-generator";
import { HTMLTemplate, isTemplate } from "./template-html";

/*
the rendering pipeline is built around one struct: SourceHandle

three kinds of producer can fill a component's "current source" slot: a static template, a render function, or a generator. they reduce to one handle shape:
- static / render-function: zero-lifetime, FINISHED_HANDLE is a shared sentinel
- generator: a live handle whose step loop drives the generator until natural completion, an await, an uncaught throw, or external cancel/throwInto

all behavior on a live handle goes through free functions (cancelHandle, throwIntoHandle, internal step). same idiom as the per-binding update functions in template-html.ts and friends. nothing allocates per-step in steady state beyond the unavoidable .then closures around await
*/

//opaque context handed back to render/onError. typically the runtime, kept loose here so sources.ts has zero dependency on runtime layout
export type SourceContext = unknown;

//render fires with both the context (the runtime) and the handle that produced this template
//=> SSR needs the handle to mark the in-flight source finished even before the install function has returned (otherwise the very first yield from startRoot would race: runtime.currentHandle isn't assigned yet)
//=> CSR doesn't read the handle. it patches in place or replaces children
export type RenderCallback = (
	context: SourceContext,
	handle: SourceHandle,
	template: HTMLTemplate,
) => void;

export type ErrorCallback = (context: SourceContext, error: Error) => void;

export type YieldHandler = (handle: SourceHandle, value: unknown) => unknown;

export interface SourceHandle {
	//set on natural completion, external cancel, or uncaught throw. any pending await checks this before resuming
	finished: boolean;
	//null for static/render-function (FINISHED_HANDLE). there's no generator to drive
	generator: Generator | AsyncGenerator | null;
	//captured from the generator's `return cleanupFn` so disconnect can fire it later
	cleanup: VoidFunction | null;
	//these are populated only on live generator handles. step/cancel reach them through the struct so no per-install closure is needed
	host: BaseComponent | null;
	context: SourceContext;
	render: RenderCallback | null;
	onYield: YieldHandler | null;
	onError: ErrorCallback | null;
}

//shared sentinel for any kind that has no lifetime to manage (static template, single render-function call)
//=> install* paths can return this without allocating
const FINISHED_HANDLE: SourceHandle = {
	finished: true,
	generator: null,
	cleanup: null,
	host: null,
	context: null,
	render: null,
	onYield: null,
	onError: null,
};

export const installStaticSource = (
	context: SourceContext,
	render: RenderCallback,
	template: HTMLTemplate,
): SourceHandle => {
	render(context, FINISHED_HANDLE, template);
	return FINISHED_HANDLE;
};

export const installRenderFunctionSource = (
	context: SourceContext,
	host: BaseComponent,
	render: RenderCallback,
	renderFunction: RenderFunction,
): SourceHandle => {
	render(context, FINISHED_HANDLE, renderFunction(host));
	return FINISHED_HANDLE;
};

//for the current source: generator yields are templates (or render functions). the yield handler is module-level (currentGeneratorYield), so no per-install closure is needed
//=> split into create/begin so the caller can store the handle in runtime.currentHandle BEFORE stepping starts. otherwise a synchronous error inside the first step would invoke onError (reportCSRError on CSR, reportSSRError on SSR), which reads runtime.currentHandle to snapshot it and would see the stale value (or null) because the assignment hasn't happened yet
export const createGeneratorHandle = (
	context: SourceContext,
	host: BaseComponent,
	render: RenderCallback,
	onError: ErrorCallback,
	createGenerator: ComponentGenerator,
): SourceHandle => ({
	finished: false,
	generator: createGenerator(host),
	cleanup: null,
	host,
	context,
	render,
	onYield: currentGeneratorYield,
	onError,
});

//for the root generator: yields are install commands, not templates. the caller supplies a runtime-aware yield handler (one closure per component, not per install)
export const createRootHandle = (
	context: SourceContext,
	host: BaseComponent,
	onRootYield: YieldHandler,
	onError: ErrorCallback,
	createGenerator: ComponentGenerator,
): SourceHandle => ({
	finished: false,
	generator: createGenerator(host),
	cleanup: null,
	host,
	context,
	//root doesn't render directly. its yields go through onRootYield which decides what to install
	render: null,
	onYield: onRootYield,
	onError,
});

//begin driving a generator handle. the caller MUST have stored the handle in its runtime field first (rootHandle / currentHandle) so any synchronous error or render that re-enters runtime code reads the right reference
export const beginHandle = (handle: SourceHandle): void => {
	step(handle, handle.generator!.next(undefined));
};

//mark the handle finished, run the generator's finally via .return(), then fire any captured cleanup
//=> idempotent: a second call only fires cleanup if it was set after the first cancel (it won't be, but the shape is safe)
//=> always fires cleanup even when finished is already true. a generator that naturally completed with `return cleanupFn` stashed the fn in handle.cleanup; the cancel that follows (swap or disconnect) is when we run it
//=> safe to call on FINISHED_HANDLE (cleanup is null, generator is null, finished is already true)
export const cancelHandle = (handle: SourceHandle): void => {
	if (!handle.finished) {
		handle.finished = true;
		if (handle.generator !== null) {
			try {
				(handle.generator as Generator).return?.(undefined);
			} catch {
				//user finally block threw; swallow so the rest of teardown still runs
			}
		}
	}
	const cleanup = handle.cleanup;
	if (cleanup !== null) {
		handle.cleanup = null;
		cleanup();
	}
};

//inject an error into a live generator handle (for try/catch recovery)
//=> if the gen catches and continues, step resumes from the throw's IteratorResult
//=> if the throw escapes, the handle finishes and onError fires (parent gets to recover up the chain)
export const throwIntoHandle = (handle: SourceHandle, error: Error): void => {
	if (handle.finished || handle.generator === null) return;
	let next: IteratorResult<unknown> | Promise<IteratorResult<unknown>>;
	try {
		next = (handle.generator as Generator).throw!(error);
	} catch (uncaught) {
		handle.finished = true;
		handle.onError!(handle.context, uncaught as Error);
		return;
	}
	step(handle, next);
};

//the generator driver. loops synchronously, suspends on Promise, finishes on done/throw/cancel
//.then closures below allocate per await (unavoidable) and capture only `handle`. they consult handle.finished before resuming so a swapped-out handle's pending awaits go nowhere
const step = (
	handle: SourceHandle,
	next: IteratorResult<unknown> | Promise<IteratorResult<unknown>>,
): void => {
	while (true) {
		if (handle.finished) return;

		//async generator: .next() returned a Promise of the next IteratorResult
		if (next instanceof Promise) {
			next.then(
				(resolved) => {
					if (!handle.finished) step(handle, resolved);
				},
				(error) => {
					if (handle.finished) return;
					handle.finished = true;
					handle.onError!(handle.context, error as Error);
				},
			);
			return;
		}

		if (next.done) {
			//user's `return cleanupFn`. stash so cancelHandle can fire it later (e.g. disconnectedCallback)
			if (typeof next.value === "function") {
				handle.cleanup = next.value as VoidFunction;
			}
			handle.finished = true;
			return;
		}

		//sync generator yielded a Promise: unwrap before handing to onYield
		if (next.value instanceof Promise) {
			next.value.then(
				(resolved) => {
					if (!handle.finished) step(handle, { done: false, value: resolved });
				},
				(error) => {
					if (handle.finished) return;
					handle.finished = true;
					handle.onError!(handle.context, error as Error);
				},
			);
			return;
		}

		let result: unknown;
		try {
			result = handle.onYield!(handle, next.value);
		} catch (error) {
			handle.finished = true;
			handle.onError!(handle.context, error as Error);
			return;
		}

		//onYield can install a new source (root case) or render a template. either can run user code that synchronously errors back through this same handle, marking it finished
		//=> re-check before stepping the generator, otherwise we'd call .next() on a finished handle and shadow the real error
		if (handle.finished) return;

		try {
			next = handle.generator!.next(result);
		} catch (error) {
			handle.finished = true;
			handle.onError!(handle.context, error as Error);
			return;
		}
	}
};

//yield handler for current-source generators: yields are templates (or render functions returning templates)
//=> nested generator functions are rejected. the root is the only layer that installs sources
const currentGeneratorYield: YieldHandler = (handle, value) => {
	if (isTemplate(value)) {
		handle.render!(handle.context, handle, value);
		return handle.host;
	}
	if (typeof value === "function") {
		if (isGeneratorFunction(value)) {
			throw new Error("Inner generators cannot yield generator functions");
		}
		handle.render!(
			handle.context,
			handle,
			(value as RenderFunction)(handle.host!),
		);
		return handle.host;
	}
	//unknown value (e.g. resolved value from `yield somePromise`). hand it back as the yield expression's result
	return value;
};
