import { html } from "./parser/html";
import { props as propHelper, Schema } from "./validator/props";
import { ValueOf } from "./parser/types";
import { addOrRemoveProperty } from "./rendering/attribute";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, GeneratorFn, TemplateRenderer } from "./types";

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
) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#observer: MutationObserver;
		#render: TemplateRenderer | null = null; // renders a view
		#view: HTMLTemplate | null = null; //current rendered dom
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

		async connectedCallback() {
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
			console.warn(error);
			this.shadowRoot!.textContent = `${error}`;
		}

		#step(generator: Generator | AsyncGenerator, result: unknown) {
			while (true) {
				const next = generator.next(result);

				if (next instanceof Promise) {
					next
						.then(({ done, value }) => {
							if (done) {
								this.#cleanup = typeof value === "function" ? value : null;
								return;
							}
							this.#step(generator, value);
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
						.then((resolved) => this.#step(generator, resolved))
						.catch((error) => this.#handleError(error));
					return;
				}

				if (typeof value === "function") {
					this.#render = value as TemplateRenderer;
					result = this.#mount(value());
				} else if (value instanceof HTMLTemplate) {
					this.#render = () => value;
					result = this.#mount(value);
				} else {
					result = value;
				}
			}
		}

		#mount(template: HTMLTemplate): ShadowRoot | null {
			this.#view = template;
			if (this.#renderMode === RENDER_MODE.CSR) {
				this.shadowRoot?.replaceChildren(template.setup());
			}
			return this.shadowRoot;
		}

		async update() {
			if (!this.#render || this.#updateState !== UPDATE_STATE.IDLE) {
				return;
			}
			this.#updateState = UPDATE_STATE.SCHEDULED;
			//wait to batch repeated update calls
			await Promise.resolve();
			this.#updateState = UPDATE_STATE.RENDERING;

			let template = this.#render();

			if (!(template instanceof HTMLTemplate)) {
				template = html`${template}`;
			}

			if (
				!this.#view ||
				this.#view.parsedHTML.templateHash !== template.parsedHTML.templateHash
			) {
				this.#mount(template);
				this.#updateState = UPDATE_STATE.IDLE;
				return;
			}
			this.#view.update(template.currentExpressions);
			this.#updateState = UPDATE_STATE.IDLE;
		}
	}

	return BaseElement;
};
