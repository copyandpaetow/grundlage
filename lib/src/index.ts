import { html } from "./parser/html";
import { props as propHelper, Schema } from "./validator/props";
import { ValueOf } from "./parser/types";
import { addOrRemoveProperty } from "./rendering/attribute";
import { HTMLTemplate } from "./rendering/template-html";
import {
	BaseComponent,
	ComponentConstructor,
	GeneratorFn,
	TemplateRenderer,
} from "./types";

const defaultOptions: ShadowRootInit = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
};

const UPDATE_STATE = {
	IDLE: 0,
	SCHEDULED: 1,
	RENDERING: 2,
} as const;

const RENDER_MODE = {
	SSR: 1,
	CSR: 2,
} as const;

export { html } from "./parser/html";
export { props } from "./validator/props";

export const render = (
	componentGenerator: GeneratorFn,
	options = defaultOptions,
): ComponentConstructor => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#observer: MutationObserver;
		#render: TemplateRenderer | null = null;
		#view: HTMLTemplate | null = null;
		#cleanup: VoidFunction | null = null;
		#updateState: ValueOf<typeof UPDATE_STATE> = UPDATE_STATE.IDLE;
		#renderMode: ValueOf<typeof RENDER_MODE> = RENDER_MODE.CSR;

		constructor() {
			super();
			if (this.shadowRoot) {
				this.#renderMode = RENDER_MODE.SSR;
			} else {
				this.attachShadow(options);
			}
		}

		connectedCallback() {
			if (this.#render) {
				//prevents re-rendering everything when this element is moved
				return;
			}

			const generator = componentGenerator(this);
			this.#step(generator, undefined);
			this.#watchAttributes();
		}

		async disconnectedCallback() {
			//this callback is also called when moving inside of the dom.
			//By waiting a tick and checking if we are back in the dom, we can avoid false cleanup calls
			await Promise.resolve();
			if (!this.isConnected) {
				this.#observer?.disconnect();
				this.#render = null;
				this.#cleanup?.();
			}
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			addOrRemoveProperty(this, name, value, oldValue);
			this.update();
		}

		props(schema: Schema) {
			propHelper(this, schema);
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver(() => this.update());
			this.#observer.observe(this, { attributes: true });
		}

		#handleError(error: Error) {
			this.#render = null;
			console.warn(error);
			//visualizes the error better than just the warning
			//TODO: we could think about whether to try to revert to the previous dom?
			this.shadowRoot!.textContent = `${error}`;
		}

		//coordinates the generator process in a semi-synchronous why so connectedCallback stays synchronous as well, otherwise we get timing issues with nested components
		#step(generator: Generator | AsyncGenerator, result: unknown) {
			while (true) {
				try {
					const next = generator.next(result);

					if (next instanceof Promise) {
						next
							.then(({ done, value }) => {
								if (done) {
									this.#cleanup = typeof value === "function" ? value : null;
									return;
								}
								this.#stepAsync(generator, value);
							})
							.catch((error) => this.#handleError(error));
						return;
					}

					const { done, value } = next;
					if (done) {
						this.#cleanup = typeof value === "function" ? value : null;
						return;
					}

					if (value instanceof Promise) {
						value
							.then((resolved) => this.#stepAsync(generator, resolved))
							.catch((error) => this.#handleError(error));
						return;
					}

					result = this.#applyYieldedValue(value);
				} catch (error) {
					this.#handleError(error as Error);
					return;
				}
			}
		}

		#applyYieldedValue(value: unknown): unknown {
			if (typeof value === "function") {
				this.#render = value as TemplateRenderer;
				return this.#mount(value());
			} else if (value instanceof HTMLTemplate) {
				this.#render = () => value;
				return this.#mount(value);
			}
			return value;
		}

		#stepAsync(generator: Generator | AsyncGenerator, value: unknown) {
			try {
				const result = this.#applyYieldedValue(value);
				this.#step(generator, result);
			} catch (error) {
				this.#handleError(error as Error);
			}
		}

		#mount(template: HTMLTemplate): ShadowRoot | null {
			this.#view = template;
			if (this.#renderMode === RENDER_MODE.CSR) {
				this.shadowRoot?.replaceChildren(template.setup());
			} else {
				this.#view.hydrate(this.shadowRoot!);
				this.#renderMode = RENDER_MODE.CSR;
			}
			return this.shadowRoot;
		}

		async update() {
			if (
				!this.#render ||
				this.#updateState !== UPDATE_STATE.IDLE ||
				!this.isConnected
			) {
				return;
			}
			this.#updateState = UPDATE_STATE.SCHEDULED;
			//wait to batch repeated update calls
			await Promise.resolve();
			this.#updateState = UPDATE_STATE.RENDERING;

			try {
				let template = this.#render();

				if (!(template instanceof HTMLTemplate)) {
					template = html`${template}`;
				}

				if (
					!this.#view ||
					this.#view.parsedHTML.templateHash !==
						template.parsedHTML.templateHash
				) {
					this.#mount(template);
					this.#updateState = UPDATE_STATE.IDLE;
					return;
				}
				this.#view.update(template.currentExpressions);
			} catch (error) {
				this.#handleError(error as Error);
			}
			this.#updateState = UPDATE_STATE.IDLE;
		}
	}

	return BaseElement;
};
