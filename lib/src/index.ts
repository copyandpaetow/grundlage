import { applyDynamicAttribute } from "./rendering/dynamic-attribute";
import { html as htmlValue } from "./template-value";
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
	Engine,
	hasRenderer,
	scheduleNextUpdate,
	startEngine,
	startServerEngine,
	stopEngine,
} from "./rendering/engine";
import { FormBase } from "./forms/form-base";

export { props } from "./validator/props";
export {
	type ComponentOptions,
	type BaseComponent,
	type Template,
} from "./types";
export { load, type LoadOptions } from "./loader/load";

export const html = htmlValue as unknown as (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => Template;

export const render = (
	componentGenerator: ComponentGenerator,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	const ParentClass: typeof HTMLElement = options.formAssociated
		? FormBase
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		#engine: Engine | null = null;
		#hydratePending: boolean;
		//todo: captured here for shadowRoot close mode. But would it help to inline the engine in here?
		//todo: this currently is very little here
		#shadowRoot: ShadowRoot;

		constructor() {
			super();
			const prerendered = this.shadowRoot !== null;
			this.#shadowRoot = prerendered
				? this.shadowRoot!
				: this.attachShadow(options);
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
			this.#watchAttributes();
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

		#watchAttributes() {
			const painter = this.#engine!.painter;
			painter.attributeObserver?.disconnect();
			const observer = new MutationObserver(() => this.update());
			observer.observe(this, { attributes: true });
			painter.attributeObserver = observer;
		}

		update(): Promise<void> {
			const engine = this.#engine;
			if (engine === null || !hasRenderer(engine)) return Promise.resolve();
			return scheduleNextUpdate(engine);
		}
	}

	return BaseElement;
};
