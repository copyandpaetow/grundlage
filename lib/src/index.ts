import { applyDynamicAttribute } from "./rendering/bindings/attribute-dynamic";
import { html as htmlValue } from "./template";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentGenerator,
	ComponentOptions,
	Template,
} from "./types";
import { isServer } from "./utils/guards";
import { createPainter, setupAttributeObserver } from "./runtime/painter";
import { createEngine, Engine } from "./runtime/engine";
import {
	hasRenderer,
	scheduleNextUpdate,
	startEngine,
	stopEngine,
} from "./runtime/engine-client";
import { startServerEngine } from "./runtime/engine-server";
import { FormBase } from "./forms";

export { props } from "./props";
export {
	type ComponentOptions,
	type BaseComponent,
	type Template,
} from "./types";
export { load, type LoadOptions } from "./load";

const defaultOptions: ComponentOptions = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
} as const;

export const html = htmlValue as unknown as (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => Template;

export const render = (
	componentGenerator: ComponentGenerator,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	const mergedOptions = { ...defaultOptions, ...options };
	const ParentClass: typeof HTMLElement = options.formAssociated
		? FormBase
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		#engine: Engine | null = null;
		#hydratePending: boolean;
		#shadowRoot: ShadowRoot;

		constructor() {
			super();
			const prerendered = this.shadowRoot !== null;
			this.#shadowRoot = prerendered
				? this.shadowRoot!
				: this.attachShadow(mergedOptions);
			this.#hydratePending = prerendered;
		}

		connectedCallback() {
			if (this.#engine !== null && this.#engine.outer !== null) return;
			this.#engine ??= createEngine(
				this,
				createPainter(this, this.#shadowRoot, this.#hydratePending),
				componentGenerator,
			);
			if (isServer()) return startServerEngine(this.#engine);
			setupAttributeObserver(this.#engine.painter, () => this.update());
			startEngine(this.#engine);
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (this.isConnected) return;
			const engine = this.#engine;
			if (engine === null || engine.outer === null) return;
			stopEngine(engine);
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			applyDynamicAttribute(this, name, value, oldValue);
			this.update();
		}

		update(): Promise<void> {
			const engine = this.#engine;
			if (engine === null || !hasRenderer(engine)) return Promise.resolve();
			return scheduleNextUpdate(engine);
		}
	}

	return BaseElement;
};
