import { applyAttributeBinding } from "./rendering/attribute";
import { html as parseTemplate } from "./parser/html";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentGenerator,
	ComponentOptions,
	Template,
} from "./types";
import { defaultOptions } from "./utils/constants";
import { isServer } from "./utils/is-server";
import { createPainter } from "./rendering/painter";
import {
	createEngine,
	driveServerOnce,
	Engine,
	enqueueUpdate,
	hasRerunnableCurrent,
	startEngine,
	teardownEngine,
} from "./rendering/engine";
import { FormBase } from "./forms/form-base";

export { props } from "./validator/props";
export {
	type ComponentOptions,
	type BaseComponent,
	type Template,
} from "./types";
export { load, type LoadOptions } from "./loader/load";

/**
 * Tagged template literal for markup. Parsed once and cached; later renders only
 * touch the dynamic parts. Returns an opaque {@link Template} to yield or embed.
 */
//the real return type (HTMLTemplate) is an internal class; we re-type the export to the opaque Template so the published .d.ts doesn't leak the parser/runtime internals reachable through it
export const html = parseTemplate as unknown as (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => Template;

/**
 * Defines a web component from a generator. Returns a custom element constructor —
 * register it with `customElements.define`. The generator receives the host element,
 * yields render functions or `html` templates, and returns an optional cleanup function.
 */
export const render = (
	componentGenerator: ComponentGenerator,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	//FormBase carries `static formAssociated` + attachInternals; it inherits down to BaseElement, and the browser reads formAssociated off the subclass at define time
	const ParentClass: typeof HTMLElement = options.formAssociated
		? FormBase
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		//the one engine, the privacy capsule: the VM machine + both coroutines + the coalescing
		//coordinator + the painter, reached only through this #field. persistent across reconnect (the
		//painter keeps its renderedTemplate for DOM continuity), so a reconnect resets the GENERATION in
		//place via an epoch bump rather than swapping struct identity. null only before the first connect.
		#engine: Engine | null = null;
		//true when an SSR shadow root was already attached at construction; consumed by the first paint.
		//captured here (not derived in connectedCallback) because it reads `this.shadowRoot !== null`
		//BEFORE the constructor's attachShadow makes that always-true
		#hydratePending: boolean;

		constructor() {
			super();
			//if a shadow root already exists, the prerender plugin attached it before upgrade. we'll hydrate into it on the first render
			const prerendered = this.shadowRoot !== null;
			if (!prerendered) this.attachShadow(options);
			this.#hydratePending = prerendered;
		}

		connectedCallback() {
			//moving an element in the DOM fires disconnectedCallback then connectedCallback
			//=> a live generation (outer set) means this is a move; bail so it isn't restarted from scratch
			if (this.#engine !== null && this.#engine.outer !== null) return;
			//build the engine ONCE; it survives reconnect. the painter is created with it and kept across
			//reconnect for DOM continuity, while teardownEngine resets the generation fields each disconnect
			this.#engine ??= createEngine(
				this,
				createPainter(this, this.#hydratePending),
				componentGenerator,
			);
			//the server paints once and never re-runs: no attribute observer, no flush, no waiters
			if (isServer()) return driveServerOnce(this.#engine);
			this.#watchAttributes();
			startEngine(this.#engine);
		}

		async disconnectedCallback() {
			//also fires when moving inside the DOM
			//=> wait a tick and bail if we're back so the move doesn't trigger a teardown
			await Promise.resolve();
			if (this.isConnected) return;
			const engine = this.#engine;
			if (engine === null || engine.outer === null) return; //already torn down / never started
			teardownEngine(engine);
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeBinding(this, name, value, oldValue);
			this.update();
		}

		#watchAttributes() {
			const painter = this.#engine!.painter;
			painter.attributeObserver?.disconnect();
			const observer = new MutationObserver(() => this.update());
			observer.observe(this, { attributes: true });
			painter.attributeObserver = observer;
		}

		update(): Promise<void> {
			const engine = this.#engine;
			//the null / no-current guard IS the C6 contract: never started, server, disconnected (renderer
			//cleared on teardown), or a static template current ⇒ no-op resolve, so `await update()` never
			//hangs. otherwise ride the open flush or open one — enqueueUpdate owns the coalescing window.
			if (engine === null || !hasRerunnableCurrent(engine))
				return Promise.resolve();
			return enqueueUpdate(engine);
		}
	}

	return BaseElement;
};
