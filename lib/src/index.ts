import { html } from "./parser/html";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, Component, TemplateRenderer } from "./types";

const defaultOptions: ShadowRootInit = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
};

export { html } from "./parser/html";

export const render: Component = (
	name,
	componentGenerator,
	options = defaultOptions,
) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#render: TemplateRenderer | null = null;
		#view: HTMLTemplate | null = null;
		#cleanup: ((props: Record<string, unknown>) => void) | null = null;
		#isUpdating = false;
		#isSSR = false;

		constructor() {
			super();

			if (this.shadowRoot) {
				this.#isSSR = true;
			} else {
				this.attachShadow(options);
			}
		}

		async connectedCallback() {
			for (const attr of this.attributes) {
				this.#props.set(attr.name, attr.value);
			}
			await this.#setup();
			this.#watchAttributes();
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (!this.isConnected) {
				this.#observer?.disconnect();
				this.#cleanup?.(Object.fromEntries(this.#props));
			}
		}

		setProperty(name: string, value: unknown) {
			const previousValue = this.#props.get(name);
			if (previousValue === value) {
				return;
			}

			if (
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean"
			) {
				this.setAttribute(name, String(value));
			}

			if (value === undefined || value === null) {
				this.#props.delete(name);
				this.removeAttribute(name);
				return;
			}

			this.#props.set(name, value);
			this.update();
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver((mutations) => {
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
				const generator = componentGenerator(
					Object.fromEntries(this.#props),
					this,
				);
				let result;

				while (true) {
					const { done, value } = await generator.next(result);

					if (done) {
						if (typeof value === "function") {
							this.#cleanup = value;
						}
						break;
					}

					if (value instanceof Promise) {
						result = await value;
						continue;
					}

					const template =
						typeof value === "function"
							? value(Object.fromEntries(this.#props))
							: value;

					if (template instanceof HTMLTemplate) {
						if (!this.#isSSR) {
							this.shadowRoot?.replaceChildren(template.setup());
						}

						this.#view = template;
						this.#render = (
							typeof value === "function" ? value : () => value
						) as TemplateRenderer;
						result = this.shadowRoot;
						continue;
					}

					result = value;
				}

				console.log(this.#isSSR, this.#view);

				if (this.#isSSR) {
					this.#view!.hydrate(this.shadowRoot!);
				}
			} catch (error) {
				console.error(error);
				this.shadowRoot!.textContent = `${error}`;
			}
		}

		async update() {
			if (!this.#render || this.#isUpdating) {
				return;
			}
			this.#isUpdating = true;
			await Promise.resolve().then();

			let template = this.#render(Object.fromEntries(this.#props));

			if (!(template instanceof HTMLTemplate)) {
				template = html`${template}`;
			}

			if (
				!this.#view ||
				this.#view.parsedHTML.templateHash !== template.parsedHTML.templateHash
			) {
				this.shadowRoot?.replaceChildren(template.setup());
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

	return (currentProps = {}) => {
		return html`<${name} ${currentProps}></${name}>`;
	};
};
