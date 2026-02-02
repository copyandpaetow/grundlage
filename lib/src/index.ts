import "./parser/parser-css";
import { html } from "./parser/parser-html";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, Component, TemplateRenderer } from "./types";

const defaultOptions: ShadowRootInit = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
};

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

		constructor() {
			super();
			this.attachShadow(options);
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

			todo: setExpressions could be nicer / less oop

			* if a tag is changed, we lose some internal states, eventListeners get reapplied
			todo: restore focus, animation, scroll position


			### future ###

			? we should be able to detect if there already is a template and in that case just read the markers and dont update
			=> we would need to mark the comments somehow so they are recognizable but also different from the list markers

			? template updating became a little ugly, it would be nice not to carry around 2 expression arrays

			? maybe it would be cleaner for the parser to return a string instead of the documentFragment and we do the caching in a different step?
			
			todo: attributes get a starting whitespace, the current trimStart would need a better solution

			todo: CSSTemplates need to be added as style and as class
			=> for now lets make it simple and replace the whole block whenever a value changes

		
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
				this.shadowRoot!.textContent = `${error}`;
			}
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	return (currentProps = {}) => {
		return html`<${name} ${currentProps}></${name}>`;
	};
};
