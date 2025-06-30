import { defaultKeyFn } from "./mount/mount";
import { updateDOM } from "./mount/update-dom";
import { html, type ParsingResult } from "./template/html";
import "./template/signals";

export type ComponentOptions = {};

export type Props = Record<string, unknown>;

export type RenderFn = (props: Props) => ParsingResult;

export type ComponentProps<Props = Record<string, unknown>> = (
	name: string,
	renderFn: RenderFn,
	options?: ComponentOptions
) => (props?: Props) => ParsingResult;

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
				const { bindings, fragment } = renderFn(
					Object.fromEntries(this.#props)
				);
				console.timeEnd("parse");

				// const result = updateDOM(fragment, {
				// 	activeValue: () => undefined,
				// 	keyFn: defaultKeyFn,
				// });

				this.shadowRoot!.replaceChildren(fragment);
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
