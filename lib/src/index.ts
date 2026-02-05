import { html } from "./parser/html";
import { ValueOf } from "./parser/types";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, Component, TemplateRenderer } from "./types";

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
		#props: Record<string, unknown> = {};
		#observer: MutationObserver;
		#render: TemplateRenderer | null = null;
		#view: HTMLTemplate | null = null;
		#cleanup: ((props: Record<string, unknown>) => void) | null = null;
		#isUpdating = false;
		#renderMode: ValueOf<typeof RENDER_MODE> = RENDER_MODE.CSR;
		#syncAttributeInProgress = false;

		constructor() {
			super();
			if (this.shadowRoot) {
				this.#renderMode = RENDER_MODE.SSR;
			} else {
				this.attachShadow(options);
			}
		}

		async connectedCallback() {
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

			if (
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean"
			) {
				this.#syncAttributeInProgress = true;
				this.setAttribute(name, String(value));
				this.#syncAttributeInProgress = false;
			}

			if (value === undefined || value === null) {
				delete this.#props[name];
				this.#syncAttributeInProgress = true;
				this.removeAttribute(name);
				this.#syncAttributeInProgress = false;
			} else {
				this.#props[name] = value;
			}

			this.update();
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver((mutations) => {
				if (this.#syncAttributeInProgress) {
					return;
				}
				for (const mutation of mutations) {
					this.setProperty(
						mutation.attributeName!,
						this.getAttribute(mutation.attributeName!),
					);
				}
			});
			this.#observer.observe(this, { attributes: true });
		}

		/*
			*next steps
			### bugs ###

			* if a tag is changed, we lose some internal states, eventListeners get reapplied
			todo: restore focus, animation, scroll position


			### future ###

			? template updating became a little ugly, it would be nice not to carry around 2 expression arrays

			? maybe it would be cleaner for the parser to return a string instead of the documentFragment and we do the caching in a different step?
			
			? should we allow for styles to be directly added as a class on a component? Have styles register in an additional way?

			? We could try to isolate changes in the css and only update the specific rule

			? Do we need a more precise SSR? 
			=> Like having a meta data comment that shows the current template hash and we walk the iterator until we find that hash?

		*/

		async #setup() {
			try {
				const generator = componentGenerator(this.#props, this);
				let result;

				while (true) {
					const { done, value } = await generator.next(result);

					if (done) {
						this.#cleanup = typeof value === "function" ? value : null;
						break;
					}

					result = await this.#processYield(value);
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

		async #processYield(value: unknown): Promise<unknown> {
			if (value instanceof Promise) {
				return value;
			}

			if (typeof value === "function") {
				this.#render = value as TemplateRenderer;
				return this.#mount(value(this.#props));
			}

			if (value instanceof HTMLTemplate) {
				this.#render = () => value;
				return this.#mount(value);
			}

			return value;
		}

		#mount(template: HTMLTemplate): ShadowRoot | null {
			this.#view = template;
			if (this.#renderMode === RENDER_MODE.CSR) {
				this.shadowRoot?.replaceChildren(template.setup());
			}
			return this.shadowRoot;
		}

		async update() {
			if (!this.#render || this.#isUpdating) {
				return;
			}
			this.#isUpdating = true;
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
				this.#isUpdating = false;
				return;
			}
			this.#view.update(template.currentExpressions);
			this.#isUpdating = false;
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	return (props = {}) => {
		return html`<${name} ${props}></${name}>`;
	};
};
