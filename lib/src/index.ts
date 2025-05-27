import { createContext, createUserContext, type UserContext } from "./context";
import { requestIsomorphicAnimationFrame } from "./mount/helper";
import { defaultKeyFn } from "./mount/mount";
import { updateDOM } from "./mount/update-dom";
import { css, type CssParsingResult } from "./template/css";
import { html, type ParsingResult } from "./template/html";

const tryCallback = (callback: VoidFunction) => {
	try {
		callback();
	} catch (error) {
		console.warn(error);
	}
};

//TODO: rethink options
export type ComponentOptions = {};

export type Props = Record<string, unknown>;

export type RenderFn = (props: Props, context: UserContext) => ParsingResult;

export type ComponentProps<Props = Record<string, unknown>> = ((
	name: string,
	renderFn: RenderFn,
	options?: ComponentOptions
) => (props?: Props) => ParsingResult) & {
	html: (
		tokens: TemplateStringsArray,
		...dynamicValues: Array<unknown>
	) => ParsingResult;
	css: (
		tokens: TemplateStringsArray,
		...dynamicValues: Array<unknown>
	) => CssParsingResult;
};

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, renderFn, options = {}) => {
	class BaseElement extends HTMLElement {
		#props = new Map<string, unknown>();
		#context = createContext();
		#observer: MutationObserver;
		#nextRender: number | null;

		constructor() {
			super();
			this.attachShadow({ mode: "open", serializable: true });
			Array.from(this.attributes).forEach((attr) => {
				this.#props.set(attr.name, attr.value);
			});
		}

		connectedCallback() {
			this.#render();
			this.#context.mountCallbacks.forEach(tryCallback);
			this.#watchAttributes();
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (!this.isConnected) {
				this.#observer?.disconnect();
				this.#context.unMountCallbacks.forEach(tryCallback);
				this.#props.clear();
				this.#context.dispose();
			}
		}

		setProperty(name: string, value: unknown) {
			//TODO: this is used internally, should there be props we dont watch in general?
			if (name === "style") {
				return;
			}
			const previousValue = this.#props.get(name);
			if (previousValue === value) {
				return;
			}

			value === undefined || value === null
				? this.#props.delete(name)
				: this.#props.set(name, value);

			this.#queueRender();
		}

		#queueRender() {
			if (this.#nextRender) {
				cancelAnimationFrame(this.#nextRender);
			}
			this.#nextRender = requestIsomorphicAnimationFrame(() => {
				this.#render();
				this.#nextRender = null;
			});
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

		#render() {
			try {
				const { template, values } = renderFn(
					Object.fromEntries(this.#props),
					createUserContext(this.shadowRoot!, this.#context)
				);
				const parsedTemplate = new Range().createContextualFragment(template);
				this.#context.values = values;
				const result = updateDOM(
					parsedTemplate,
					{
						activeValue: () => undefined,
						keyFn: defaultKeyFn,
					},
					this.#context
				);

				this.shadowRoot!.replaceChildren(result);
			} catch (error) {
				console.error(error);
				this.shadowRoot!.innerHTML = `${error}`;
			}
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	return (currentProps = {}) =>
		html`<${name} ${{ ...currentProps }}></${name}>`;
};

render.html = html;
render.css = css;
