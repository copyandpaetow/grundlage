import "./rendering/parser-css";
import { html } from "./rendering/parser-html";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, ComponentProps, RenderFn } from "./types";

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, generatorFn, options = {}) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#renderFn: RenderFn | null = null;
		#renderTemplate: HTMLTemplate | null = null;
		#cleanupFn: ((props: Record<string, unknown>) => void) | null = null;

		constructor() {
			super();
			this.attachShadow({ mode: "open", serializable: true });
			Array.from(this.attributes).forEach((attr) => {
				this.#props.set(attr.name, attr.value);
			});
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

			value === undefined || value === null
				? this.#props.delete(name)
				: this.#props.set(name, value);
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver((mutations) => {
				mutations.forEach((mutation) => {
					this.setProperty(
						mutation.attributeName!,
						this.getAttribute(mutation.attributeName!)
					);
				});
			});
			this.#observer.observe(this, { attributes: true });
		}

		/*
			*next steps

			### structure ###

			todo: CSSTemplates need to be added as style and as class
			=> for now lets make it simple and replace the whole block whenever a value changes
			=> when do we need to add a dynamically generated class 

			todo: attribute boolean values need special considerations as arrays and objects need to be expanded
			todo: friendly primitives should be added as string attribute and as prop, where the prop wins when added to the internal object
			* null/undefined remove the prop, functions/arrays/objects will get added only as props

			todo: hash functions needs to handle more cases (fn, obj, sets, maps, etc)
			todo: try hashes as stable keys for list items 

			todo: use constants for brackets and other chars we test for

			todo: shallow comparing 2 htmlTemplate classes will always be false, we would need to compare template hashes and then value hashes

			### api design ###

			todo: decide how to handle props. Always strings? Pass them into the component somehow?
			? adding them as props wouldnt be difficult, but then there the attribute is still there. What would be its value? 

			### code consistency
			- use one type of loop 


			### future

			? delay rendering if component is not visible? could be checked if intersection observer

			? convinience helpers like onVisibilityChange, onResize, etc

		
		*/

		async update() {
			if (!this.#renderFn) {
				return;
			}

			let template = this.#renderFn(Object.fromEntries(this.#props));

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
				const generator = generatorFn(Object.fromEntries(this.#props), this);
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
						this.#renderFn = (
							typeof value === "function" ? value : () => value
						) as RenderFn;
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
