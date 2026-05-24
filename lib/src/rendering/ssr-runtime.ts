import { html } from "../parser/html";
import { flushHostPayload } from "../loader/load-data";
import { BaseComponent, ComponentGenerator, RenderFunction } from "../types";
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
	YieldHandler,
} from "./sources";
import { HTMLTemplate } from "./template-html";
import { RUNTIME_KIND } from "../utils/constants";

/*
server runtime: runs the user's generator(s) until the first renderable yield, paints once, then tears everything down

contract differences vs CSR:
- there's no update(). attribute changes can't trigger re-renders on the server
- the first template is the LAST one we render. any further yields are abandoned (the cancel on the inner generator runs its finally; we discard whatever the finally returned)
- no MutationObserver, no observer bracket around the DOM write, no shape-hash patch loop. this is a one-shot path
- a thrown error still surfaces (console.warn + writes into the shadow root) so the SSR pass produces a visible failure rather than a silent blank

the install path is the same shape as CSR (root yields decide what kind of current source to install) but the render callback is a one-shot. it paints, finalizes, and cancels both layers
*/

export interface SSRRuntime {
	readonly kind: typeof RUNTIME_KIND.SSR;
	host: BaseComponent;
	rootHandle: SourceHandle | null;
	currentHandle: SourceHandle | null;
	//true once the first template has been painted; subsequent renders are no-ops
	done: boolean;
}

export const createSSRRuntime = (host: BaseComponent): SSRRuntime => ({
	kind: RUNTIME_KIND.SSR,
	host,
	rootHandle: null,
	currentHandle: null,
	done: false,
});

export const startSSRRoot = (
	runtime: SSRRuntime,
	createGenerator: ComponentGenerator,
): void => {
	//mirror CSR's split: store first, then drive. SSR also needs the assignment in place before stepping so handleRootYield can read runtime.rootHandle if something re-enters
	runtime.rootHandle = createRootHandle(
		runtime,
		runtime.host,
		handleRootYield,
		reportSSRError,
		createGenerator,
	);
	beginHandle(runtime.rootHandle);
};

export const teardownSSRRuntime = (runtime: SSRRuntime): void => {
	if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
	if (runtime.rootHandle !== null) cancelHandle(runtime.rootHandle);
	runtime.currentHandle = null;
	runtime.rootHandle = null;
};

//same root-yield shape as CSR: decide kind and install. the difference is what `renderOnce` does next
//=> if the install path painted synchronously (the common case for static/render-fn or a sync inner gen), we cancel the root right here using the rootHandle parameter. runtime.rootHandle may still be null on the very first call (startSSRRoot hasn't assigned it yet)
const handleRootYield: YieldHandler = (rootHandle, value) => {
	const runtime = rootHandle.context as SSRRuntime;
	if (runtime.done) return runtime.host;
	if (value instanceof HTMLTemplate) {
		if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
		runtime.currentHandle = installStaticSource(runtime, renderOnce, value);
	} else if (typeof value === "function") {
		if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
		if (isGeneratorFunction(value)) {
			runtime.currentHandle = createGeneratorHandle(
				runtime,
				runtime.host,
				renderOnce,
				reportSSRError,
				value as ComponentGenerator,
			);
			beginHandle(runtime.currentHandle);
		} else {
			runtime.currentHandle = installRenderFunctionSource(
				runtime,
				runtime.host,
				renderOnce,
				value as RenderFunction,
			);
		}
	} else {
		return value;
	}
	if (runtime.done) cancelHandle(rootHandle);
	return runtime.host;
};

//one-shot RenderCallback. paint into the shadow root, drain the loadData buffer, mark the in-flight current source finished so its step loop unwinds
//=> the rootHandle gets cancelled by handleRootYield after the install returns (it has the rootHandle reference even when runtime.rootHandle is still null)
//=> further calls (e.g. a sync generator yielding multiple templates in one tick) short-circuit on `done`
const renderOnce: RenderCallback = (context, handle, value) => {
	const runtime = context as SSRRuntime;
	if (runtime.done) return;
	runtime.done = true;
	const template = value instanceof HTMLTemplate ? value : html`${value}`;

	//if the host already had a shadow root with content before construction, the prerender plugin attached it; hydrate. otherwise this is a fresh server render and we set up from scratch
	if (runtime.host.shadowRoot?.firstChild) {
		template.hydrate(runtime.host);
	} else {
		runtime.host.shadowRoot?.replaceChildren(template.setup(runtime.host));
	}
	flushHostPayload(runtime.host);

	//cancel the in-flight current source (the handle parameter). FINISHED_HANDLE for static/render-fn is a no-op. for a generator handle, .return() runs the user's finally; we drop the IteratorResult per the SSR throwaway contract
	cancelHandle(handle);
};

//doubles as the ErrorCallback for both layers and the entry point index.ts calls when update() throws on the server. every error path tears the whole runtime down because there's no recovery model on SSR
export const reportSSRError: ErrorCallback = (context, error) => {
	const runtime = context as SSRRuntime;
	if (runtime.currentHandle !== null) cancelHandle(runtime.currentHandle);
	if (runtime.rootHandle !== null) cancelHandle(runtime.rootHandle);
	runtime.currentHandle = null;
	runtime.rootHandle = null;
	console.warn(error);
	runtime.host.shadowRoot!.textContent = `${error}`;
};
