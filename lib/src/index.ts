import { type Result } from "./template/html";
import { renderDom } from "./template/render";
import "./template/signals";

export type ComponentOptions = {};

export type Props = Record<string, unknown>;

export type RenderFn = (props: Props) => Result;

export type ComponentProps<Props = Record<string, unknown>> = (
	name: string,
	renderFn: RenderFn,
	options?: ComponentOptions
) => (props?: Props) => Result;

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, renderFn, options = {}) => {
	class BaseElement extends HTMLElement {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;

		constructor() {
			super();
			this.attachShadow({ mode: "open", serializable: true });
			Array.from(this.attributes).forEach((attr) => {
				this.#props.set(attr.name, attr.value);
			});
		}

		connectedCallback() {
			this.#render();
			this.#watchAttributes();
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (!this.isConnected) {
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
				console.time("parse");

				//*we cant further build the strings here as they need to be build inside of a signal context
				const result = renderFn(Object.fromEntries(this.#props));
				console.timeEnd("parse");

				console.log(result);
				this.shadowRoot!.replaceChildren(renderDom(result));
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
