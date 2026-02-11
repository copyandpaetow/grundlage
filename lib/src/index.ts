import { html } from "./parser/html";
import { ValueOf } from "./parser/types";
import { HTMLTemplate } from "./rendering/template-html";
import {
	BaseComponent,
	Component,
	GeneratorFn,
	Props,
	TemplateRenderer,
} from "./types";

const defaultOptions: ShadowRootInit = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
};

const RENDER_MODE = {
	SSR: 1,
	CSR: 2,
} as const;

export { html } from "./parser/html";

export const render: Component = (
	name,
	componentGenerator,
	options = defaultOptions,
) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props: Props = {};
		#observer: MutationObserver;
		#render: TemplateRenderer | null = null; // renders a view
		#view: HTMLTemplate | null = null; //current rendered dom
		#cleanup: ((props: Props) => void) | null = null;
		#updateScheduled = false;
		#renderMode: ValueOf<typeof RENDER_MODE> = RENDER_MODE.CSR;
		#duplicatedMutationCallbacks = new Set();

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
			for (const attr of this.attributes) {
				this.#props[attr.name] = attr.value;
			}
			await this.#setup();
			this.#watchAttributes();
		}

		async disconnectedCallback() {
			//this callback is also called when moving inside of the dom.
			//By waiting a tick and checking if we are back in the dom, we can avoid false cleanup calls
			await Promise.resolve();
			if (!this.isConnected) {
				this.#observer?.disconnect();
				this.#cleanup?.(this.#props);
			}
		}

		setProperty(name: string, value: unknown) {
			const previousValue = this.#props[name];
			if (previousValue === value) {
				return;
			}
			/*
			changing the attribute creates a delayed callback from the mutation observer, that itself triggers the setProperty again
			*/

			this.#duplicatedMutationCallbacks.add(name);

			if (
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean"
			) {
				this.setAttribute(name, String(value));
			}

			if (value === undefined || value === null) {
				delete this.#props[name];
				this.removeAttribute(name);
			} else {
				this.#props[name] = value;
			}

			this.update();
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (this.#duplicatedMutationCallbacks.has(mutation.attributeName)) {
						this.#duplicatedMutationCallbacks.delete(mutation.attributeName);
						continue;
					}

					this.setProperty(
						mutation.attributeName!,
						this.getAttribute(mutation.attributeName!),
					);
				}
			});
			this.#observer.observe(this, { attributes: true });
		}

		async #setup() {
			try {
				const generator = (componentGenerator as GeneratorFn<Props>)(
					this.#props,
					this,
				);
				let result;

				while (true) {
					const next = generator.next(result);
					const { done, value } = next instanceof Promise ? await next : next;

					if (done) {
						this.#cleanup = typeof value === "function" ? value : null;
						break;
					}

					if (value instanceof Promise) {
						result = await value;
					} else if (typeof value === "function") {
						this.#render = value;
						result = this.#mount(value(this.#props));
					} else if (value instanceof HTMLTemplate) {
						this.#render = () => value;
						result = this.#mount(value);
					} else {
						result = value;
					}
				}

				if (this.#view && this.#renderMode === RENDER_MODE.SSR) {
					this.#view.hydrate(this.shadowRoot!);
					this.#renderMode = RENDER_MODE.CSR;
				}
			} catch (error) {
				console.error(error);
				this.shadowRoot!.textContent = `${error}`;
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
			if (!this.#render || this.#updateScheduled) {
				return;
			}
			this.#updateScheduled = true;
			//wait to batch repeated update calls
			await Promise.resolve();

			let template = this.#render(this.#props);

			if (!(template instanceof HTMLTemplate)) {
				template = html`${template}`;
			}

			if (
				!this.#view ||
				this.#view.parsedHTML.templateHash !== template.parsedHTML.templateHash
			) {
				this.#mount(template);
				this.#updateScheduled = false;
				return;
			}
			this.#view.update(template.currentExpressions);
			this.#updateScheduled = false;
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	return (props = {}) => {
		return html`<${name} ${props}></${name}>`;
	};
};
