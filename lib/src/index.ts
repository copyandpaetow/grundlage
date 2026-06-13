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
import { createPainter, Painter, teardownPainter } from "./rendering/painter";
import {
	clientCommit,
	createProducer,
	resolveSettle,
	serverCommit,
	Producer,
	startRoot,
	teardownProducer,
} from "./rendering/producer";
import {
	createScheduler,
	resetScheduler,
	runFlushLoop,
	Scheduler,
} from "./rendering/scheduler";
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
		//capabilities held as struct fields (Scheduler → Producer → Painter, acyclic). #producer/#scheduler
		//are null between disconnect and the next connect — and that null IS the disconnected state
		//update() guards on (C6). #painter is kept across a reconnect for DOM continuity (its
		//renderedTemplate lets the first render after reconnect patch in place)
		#painter: Painter | null = null;
		//ONE Producer for both modes (the server is the client minus the scheduler); the factory picks
		//the commit strategy. null between disconnect and the next connect
		#producer: Producer | null = null;
		//client-only: the #1-batching coordinator. stays null on the server — and that null IS update()'s
		//SSR/disconnected no-op guard (C6)
		#scheduler: Scheduler | null = null;
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
			//=> if the generator lifetime is already live we bail so a move doesn't restart it from scratch
			if (this.#producer !== null) return;
			//server-vs-client is decided here, at connect (a local, not a field): it gates only this
			//method's wiring and is never read again across the element's lifetime
			const onServer = isServer();
			//keep #painter across a reconnect (DOM continuity); build a FRESH generation of producer (and,
			//on the client, scheduler) every connect — distinct struct identity is what makes
			//restart-on-reconnect safe
			this.#painter ??= createPainter(this, this.#hydratePending);
			//the server paints once and never re-runs: no attribute observer, no scheduler
			if (!onServer) {
				this.#watchAttributes();
				this.#scheduler = createScheduler();
			}
			this.#producer = createProducer(this.#painter, onServer ? serverCommit : clientCommit);
			startRoot(this.#producer, componentGenerator);
		}

		async disconnectedCallback() {
			//also fires when moving inside the DOM
			//=> wait a tick and bail if we're back so the move doesn't trigger a teardown
			await Promise.resolve();
			if (this.isConnected) return;
			if (this.#producer === null) return; //already torn down (or never connected)
			teardownPainter(this.#painter!);
			teardownProducer(this.#producer);
			resolveSettle(this.#producer); //unstick any pending `await update()` (a no-op on the server)
			if (this.#scheduler !== null) resetScheduler(this.#scheduler);
			//reassign-to-null: the next connect builds a fresh generation. only #painter survives — never
			//reuse #producer/#scheduler across generations (that would break generational isolation)
			this.#producer = null;
			this.#scheduler = null;
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeBinding(this, name, value, oldValue);
			this.update();
		}

		#watchAttributes() {
			this.#painter!.attributeObserver?.disconnect();
			const observer = new MutationObserver(() => this.update());
			observer.observe(this, { attributes: true });
			this.#painter!.attributeObserver = observer;
		}

		update(): Promise<void> {
			//the null-guard IS the C6 contract: no scheduler ⇒ SSR or disconnected ⇒ no-op resolve, so
			//`await update()` never hangs. a static current (createCurrent null) has nothing to re-run
			if (this.#scheduler === null) return Promise.resolve();
			if (this.#producer!.createCurrent === null) return Promise.resolve();
			//the coalescing gate (this batch's only branch): ride an open flush, or open one. a call
			//arriving mid-flight just flags dirty so runFlushLoop reflushes once with a fresh pull (C2–C4).
			//runFlushLoop owns the await-null window + the async-spanning settle contract (ADR-0003)
			const scheduler = this.#scheduler;
			if (scheduler.flushPromise !== null) {
				scheduler.dirty = true;
				return scheduler.flushPromise;
			}
			return (scheduler.flushPromise = runFlushLoop(scheduler, this.#producer!));
		}
	}

	return BaseElement;
};
