import { html } from "../parser/html";
import { ValueOf } from "../parser/types";
import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
import { RUNTIME_KIND, UPDATE_STATE } from "../utils/constants";
import { isGeneratorFunction } from "../utils/is-generator";
import {
	beginHandle,
	cancelHandle,
	createGeneratorHandle,
	createRootHandle,
	ErrorCallback,
	installRenderFunctionSource,
	installStaticSource,
	RenderCallback,
	SourceHandle,
	throwIntoHandle,
	YieldHandler,
} from "./sources";
import { HTMLTemplate } from "./template-html";

/*
client runtime: hot path for everything after the initial paint (or for components that never went through SSR at all)

a component has two layers running at once:
- the root source is a generator the user passed to render(). it runs once per connection; each yield decides what to install as the current source
- the current source is whatever the root most recently installed (static template, render function, or generator). it's what actually produces templates that hit the DOM

re-rendering on update() targets the CURRENT source: render-function calls re-fire, generators restart from scratch. the root never re-runs.

errors from the current source bubble UP to the root for try/catch recovery — if the root catches and yields a new producer, we install it; if the root falls through, we tear down the component (`abortAndShowError`)
*/

export interface CSRRuntime {
	readonly kind: typeof RUNTIME_KIND.CSR;
	host: BaseComponent;
	//assigned by index.ts when the observer is installed
	attributeObserver?: MutationObserver;
	renderedTemplate: HTMLTemplate | null;
	rootHandle: SourceHandle | null;
	//we keep both the create function AND the handle: handle is for cancel/throwInto, createCurrent is for re-invoking on update (generator restart, render-fn re-call)
	//both go null together when the current source is "frozen" (static) or empty — that's the dispatchUpdate no-op signal
	createCurrent: ComponentGenerator | RenderFunction | null;
	currentIsGenerator: boolean;
	currentHandle: SourceHandle | null;
	updateState: ValueOf<typeof UPDATE_STATE>;
	//true on the very first render after construction when an SSR shadow root was already attached — flips false after the hydrate pass
	hydratePending: boolean;
}

export const createCSRRuntime = (
	host: BaseComponent,
	hydratePending: boolean,
): CSRRuntime => ({
	kind: RUNTIME_KIND.CSR,
	host,
	renderedTemplate: null,
	rootHandle: null,
	createCurrent: null,
	currentIsGenerator: false,
	currentHandle: null,
	updateState: UPDATE_STATE.IDLE,
	hydratePending,
});

export const startCSRRoot = (
	runtime: CSRRuntime,
	createGenerator: ComponentGenerator,
): void => {
	//assign BEFORE driving. a synchronous yield or error during the first step calls back into runtime code (handleRootYield, currentError) that reads runtime.rootHandle — leaving the assignment until after beginHandle would race
	runtime.rootHandle = createRootHandle(
		runtime,
		runtime.host,
		handleRootYield,
		abortError,
		createGenerator,
	);
	beginHandle(runtime.rootHandle);
};

export const teardownCSRRuntime = (runtime: CSRRuntime): void => {
	runtime.attributeObserver?.disconnect();
	if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
	if (runtime.rootHandle !== null) cancelHandle(runtime.rootHandle);
	runtime.currentHandle = null;
	runtime.rootHandle = null;
	runtime.createCurrent = null;
};

//body of update() after the IDLE/SCHEDULED/RENDERING guard and microtask flip
export const dispatchCSRUpdate = (runtime: CSRRuntime): void => {
	const createCurrent = runtime.createCurrent;
	if (createCurrent === null) return;
	cancelHandle(runtime.currentHandle!);
	if (runtime.currentIsGenerator) {
		runtime.currentHandle = createGeneratorHandle(
			runtime,
			runtime.host,
			renderTemplate,
			reportCSRError,
			createCurrent as ComponentGenerator,
		);
		beginHandle(runtime.currentHandle);
	} else {
		runtime.currentHandle = installRenderFunctionSource(
			runtime,
			runtime.host,
			renderTemplate,
			createCurrent as RenderFunction,
		);
	}
};

//root-source yield: decide what kind of producer the root just handed us and install it as the current source
//=> a yielded HTMLTemplate becomes a static current (no re-runs on update)
//=> a render function or generator function becomes a re-runnable current
//=> anything else is returned as the yield expression's result (e.g. resolved value from a yielded Promise)
const handleRootYield: YieldHandler = (rootHandle, value) => {
	const runtime = rootHandle.context as CSRRuntime;
	if (value instanceof HTMLTemplate) {
		if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
		runtime.createCurrent = null;
		runtime.currentIsGenerator = false;
		runtime.currentHandle = installStaticSource(runtime, renderTemplate, value);
		return runtime.host;
	}
	if (typeof value === "function") {
		if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
		if (isGeneratorFunction(value)) {
			const createGenerator = value as ComponentGenerator;
			runtime.createCurrent = createGenerator;
			runtime.currentIsGenerator = true;
			//same create-then-begin split as startCSRRoot: any synchronous error in the inner gen calls currentError, which reads runtime.currentHandle to snapshot it. assign first so the snapshot is valid
			runtime.currentHandle = createGeneratorHandle(
				runtime,
				runtime.host,
				renderTemplate,
				reportCSRError,
				createGenerator,
			);
			beginHandle(runtime.currentHandle);
		} else {
			const renderFunction = value as RenderFunction;
			runtime.createCurrent = renderFunction;
			runtime.currentIsGenerator = false;
			runtime.currentHandle = installRenderFunctionSource(
				runtime,
				runtime.host,
				renderTemplate,
				renderFunction,
			);
		}
		return runtime.host;
	}
	return value;
};

//RenderCallback for current sources — module-level so installs don't allocate a closure per component
//=> the handle param is unused on the client: CSR doesn't tear down on render, it patches in place or replaces children
const renderTemplate: RenderCallback = (context, _handle, template) => {
	renderToDom(context as CSRRuntime, template);
};

//ErrorCallback for the current source — bubble the error up to the root for try/catch recovery
export const reportCSRError: ErrorCallback = (context, error) => {
	const runtime = context as CSRRuntime;
	const rootHandle = runtime.rootHandle;
	if (rootHandle === null || rootHandle.finished) {
		abortAndShowError(runtime, error);
		return;
	}

	//snapshot the current handle so we can tell whether the root's recovery installed a new producer (which replaces it)
	const previousCurrent = runtime.currentHandle;
	throwIntoHandle(rootHandle, error);

	//throwIntoHandle can re-enter this same handler if the rethrown error keeps escaping. if that recursion already aborted everything, the root handle is gone
	if (runtime.rootHandle === null) return;

	if (runtime.rootHandle.finished) {
		/*
		root caught the error and either returned cleanly or fell through. clean up:
		- root handle gets cancelled so any captured cleanup fires
		- if the root didn't install a new current (handleRootYield would have swapped it), the erroring current is still pointing at the dead producer — kill it too
		the previously-rendered DOM (renderedTemplate) stays put either way — that's the error contract we promise users
		*/
		cancelHandle(runtime.rootHandle);
		runtime.rootHandle = null;
		if (runtime.currentHandle === previousCurrent) {
			if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
			runtime.currentHandle = null;
			runtime.createCurrent = null;
		}
	}
};

//ErrorCallback for the root source — uncaught at the top of the stack, nowhere left to bubble
const abortError: ErrorCallback = (context, error) => {
	abortAndShowError(context as CSRRuntime, error);
};

const abortAndShowError = (runtime: CSRRuntime, error: Error): void => {
	if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
	if (runtime.rootHandle !== null) cancelHandle(runtime.rootHandle);
	runtime.currentHandle = null;
	runtime.rootHandle = null;
	runtime.createCurrent = null;
	console.warn(error);
	//we also write the error into the shadow root so it's more visible than just the console warning
	runtime.host.shadowRoot!.textContent = `${error}`;
};

const renderToDom = (runtime: CSRRuntime, value: unknown): void => {
	const template = value instanceof HTMLTemplate ? value : html`${value}`;
	const previousTemplate = runtime.renderedTemplate;

	//bracket the observer only when this render could write to the host (swap cleanup or new host bindings); components without root templates pay nothing
	const touchesHost =
		template.parsedHTML.hostBindingOffset > 0 ||
		(previousTemplate?.parsedHTML.hostBindingOffset ?? 0) > 0;

	//disconnecting empties the record queue per spec, so framework-driven host writes during this synchronous block never generate MutationRecords
	//the bracket scope is purely synchronous, so no user code can run in the gap and lose a legitimate mutation
	if (touchesHost) runtime.attributeObserver?.disconnect();
	try {
		//hot path: identical template shape + values still in their binding positions => patch in place
		if (
			previousTemplate &&
			previousTemplate.parsedHTML.templateHash ===
				template.parsedHTML.templateHash
		) {
			previousTemplate.update(template.currentExpressions);
			return;
		}

		//cold path: first render or a real shape change
		runtime.renderedTemplate = template;
		if (runtime.hydratePending) {
			//hydrate re-hooks bindings onto the prerendered shadow tree; runs at most once per component
			template.hydrate(runtime.host);
			runtime.hydratePending = false;
		} else {
			//host attributes from the previous template don't get cleared by replaceChildren (they're on the host, not in the subtree) — clean them up before setup writes the new template's host attrs
			//optional chaining on shadowRoot covers `mode: "closed"` — the read returns null in closed mode, so we skip the write rather than crash
			previousTemplate?.clearHostAttributes(runtime.host);
			runtime.host.shadowRoot?.replaceChildren(template.setup(runtime.host));
		}
	} finally {
		if (touchesHost) {
			runtime.attributeObserver?.observe(runtime.host, { attributes: true });
		}
	}
};
