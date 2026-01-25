import "./parser/parser-css";
import { html } from "./parser/parser-html";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, ComponentProps, TemplateRenderer } from "./types";

//@ts-expect-error options will come soon
export const render: ComponentProps = (
	name,
	componentGenerator,
	options = {},
) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#render: TemplateRenderer | null = null;
		#view: HTMLTemplate | null = null;
		#cleanup: ((props: Record<string, unknown>) => void) | null = null;
		#isUpdating = false;

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

			### structure ###

			todo: CSSTemplates need to be added as style and as class
			=> for now lets make it simple and replace the whole block whenever a value changes

			todo: try hashes as stable keys for list items 

			### bugs ###

			todo: attribute cutting is off, sometimes there is a space, sometimes not
			todo: parser creates self closing divs for self closing elements in general
			todo: the parser needs to be adapted in a way that the comments show the descriptor indices they are relating to 

			* if a tag is changed, we lose some internal states eventListeners get reapplied
			todo: restore focus, animation, scroll position

			### future ###

			? we could store the bindings, the pointers etc as SoA

			? delay rendering if component is not visible? could be checked if intersection observer

		
		*/

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
						this.shadowRoot?.replaceChildren(template.setup());
						this.#view = template;
						this.#render = (
							typeof value === "function" ? value : () => value
						) as TemplateRenderer;
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
