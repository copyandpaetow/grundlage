import { applyAttributeBinding } from "./rendering/attribute";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentGenerator,
	ComponentOptions,
} from "./types";
import { defaultOptions, RUNTIME_KIND, UPDATE_STATE } from "./utils/constants";
import { isServer } from "./utils/is-server";
import {
	createSSRRuntime,
	reportSSRError,
	SSRRuntime,
	startSSRRoot,
	teardownSSRRuntime,
} from "./rendering/ssr-runtime";
import {
	createCSRRuntime,
	CSRRuntime,
	dispatchCSRUpdate,
	reportCSRError,
	startCSRRoot,
	teardownCSRRuntime,
} from "./rendering/csr-runtime";
import { FormBase } from "./form-base";

export { html } from "./parser/html";
export { props } from "./validator/props";
export { type ComponentOptions, type BaseComponent } from "./types";
export { loadData, type LoadDataOptions } from "./loader/load-data";

export const render = (
	componentGenerator: ComponentGenerator,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	//FormBase carries `static formAssociated` + attachInternals; it inherits down to BaseElement, and the browser reads formAssociated off the subclass at define time
	const ParentClass: typeof HTMLElement = options.formAssociated
		? FormBase
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		#runtime: CSRRuntime | SSRRuntime;

		constructor() {
			super();
			//if a shadow root already exists, the prerender plugin attached it before upgrade. we'll hydrate into it on the first render
			const prerendered = this.shadowRoot !== null;
			if (!prerendered) this.attachShadow(options);
			this.#runtime = isServer()
				? createSSRRuntime(this)
				: createCSRRuntime(this, prerendered);
		}

		connectedCallback() {
			//moving an element in the DOM fires disconnectedCallback then connectedCallback
			//=> if the root is already running we bail out so the move doesn't restart the component from scratch
			if (this.#runtime.rootHandle !== null) return;
			//on the server we render once and cancel. no observer needed; the CSR renderTemplate guards its disconnect/observe with optional chaining to match
			if (this.#runtime.kind === RUNTIME_KIND.CSR) this.#watchAttributes();

			if (this.#runtime.kind === RUNTIME_KIND.CSR) {
				startCSRRoot(this.#runtime, componentGenerator);
			} else {
				startSSRRoot(this.#runtime, componentGenerator);
			}
		}

		async disconnectedCallback() {
			//also fires when moving inside the DOM
			//=> wait a tick and bail if we're back so the move doesn't trigger a teardown
			await Promise.resolve();
			if (this.isConnected) return;
			if (this.#runtime.kind === RUNTIME_KIND.CSR) {
				teardownCSRRuntime(this.#runtime);
			} else {
				teardownSSRRuntime(this.#runtime);
			}
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeBinding(this, name, value, oldValue);
			this.update();
		}

		#watchAttributes() {
			//SSR runtime has no observer field; this method only runs for CSR (gated in connectedCallback)
			const runtime = this.#runtime as Extract<
				CSRRuntime | SSRRuntime,
				{ kind: typeof RUNTIME_KIND.CSR }
			>;
			runtime.attributeObserver?.disconnect();
			const observer = new MutationObserver(() => this.update());
			observer.observe(this, { attributes: true });
			runtime.attributeObserver = observer;
		}

		async update() {
			const runtime = this.#runtime;
			//SSR has no update path; the first yield is final. without this guard a cached render-function source would re-run, and a user microtask scheduling update() from inside the render fn would loop forever
			if (runtime.kind !== RUNTIME_KIND.CSR) return;
			if (
				runtime.createCurrent === null ||
				runtime.updateState !== UPDATE_STATE.IDLE ||
				!this.isConnected
			) {
				return;
			}
			runtime.updateState = UPDATE_STATE.SCHEDULED;
			//wait to batch repeated update calls
			await Promise.resolve();
			runtime.updateState = UPDATE_STATE.RENDERING;

			try {
				dispatchCSRUpdate(runtime);
			} catch (error) {
				if (runtime.kind === RUNTIME_KIND.CSR) {
					reportCSRError(runtime, error as Error);
				} else {
					reportSSRError(runtime, error as Error);
				}
			} finally {
				//reportError can re-enter user code (via throwIntoHandle delivering to the root generator) and that user code can throw again
				//=> reset updateState in finally so a throw on the way out can't leave it stuck non-IDLE, which would make every future update() bail at the guard above
				runtime.updateState = UPDATE_STATE.IDLE;
			}
		}
	}

	return BaseElement;
};
