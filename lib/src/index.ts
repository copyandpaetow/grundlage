import "./rendering/parser-css";
import { html } from "./rendering/parser-html";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, ComponentProps, RenderFunction } from "./types";

//@ts-expect-error options will come soon
export const render: ComponentProps = (
	name,
	generatorFunction,
	options = {}
) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#renderFunction: RenderFunction | null = null;
		#renderTemplate: HTMLTemplate | null = null;
		#cleanupFn: ((props: Record<string, unknown>) => void) | null = null;

		constructor() {
			super();
			this.attachShadow({ mode: "open", serializable: true });
			for (const attr of this.attributes) {
				this.#props.set(attr.name, attr.value);
			}
		}

		async connectedCallback() {
			await this.#setup();
			this.#watchAttributes();
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (!this.isConnected) {
				this.#cleanupFn?.(Object.fromEntries(this.#props));
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
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					this.setProperty(
						mutation.attributeName!,
						this.getAttribute(mutation.attributeName!)
					);
				}
			});
			this.#observer.observe(this, { attributes: true });
		}

		/*
			*next steps

			### structure ###

			todo: CSSTemplates need to be added as style and as class
			=> for now lets make it simple and replace the whole block whenever a value changes

			todo: try hashes as stable keys for list items 

			### future

			? we could store the bindings, the pointers etc as SoA

			? delay rendering if component is not visible? could be checked if intersection observer

			? convinience helpers like onVisibilityChange, onResize, etc

		
		*/

		async update() {
			if (!this.#renderFunction) {
				return;
			}

			let template = this.#renderFunction(Object.fromEntries(this.#props));

			if (!(template instanceof HTMLTemplate)) {
				template = html`${template}`;
			}

			if (
				!this.#renderTemplate ||
				this.#renderTemplate.templateResult.templateHash !==
					template.templateResult.templateHash
			) {
				this.shadowRoot?.replaceChildren(template.setup());
				return;
			}
			this.#renderTemplate.update(template.currentValues);
		}

		async #setup() {
			try {
				const generator = generatorFunction(
					Object.fromEntries(this.#props),
					this
				);
				let result;

				while (true) {
					const { done, value } = await generator.next(result);

					if (done) {
						if (typeof value === "function") {
							this.#cleanupFn = value;
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
						this.shadowRoot?.replaceChildren(template.setup());
						this.#renderTemplate = template;
						this.#renderFunction = (
							typeof value === "function" ? value : () => value
						) as RenderFunction;
						result = this.shadowRoot;
						continue;
					}

					result = value;
				}
			} catch (error) {
				console.error(error);
				this.shadowRoot!.innerHTML = `${error}`;
			}
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	// return (currentProps = {}) => {
	// 	return html`<${name} ${currentProps}></${name}>`;
	// };
};
