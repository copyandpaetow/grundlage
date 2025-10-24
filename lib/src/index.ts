import "./css/css";
import { ContentHole } from "./rendering/content";
import { instance } from "./state/state";
import { BaseComponent, ComponentProps } from "./types";

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, renderFn, options = {}) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#state = new Map<string, unknown>();
		#renderTemplate: ContentHole | null = null;
		#pendingUpdate = false;

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
			const previousValue = this.#props.get(name);
			if (previousValue === value) {
				return;
			}

			value === undefined || value === null
				? this.#props.delete(name)
				: this.#props.set(name, value);
			this.#render();
		}

		setState<Value>(key: string, value: Value) {
			if (!this.hasState(key)) {
				const currentValue = (
					typeof value === "function" ? value() : value
				) as Value;
				this.#state.set(key, currentValue);
				return currentValue;
			}

			const previousValue = this.getState(key) as Value;
			const currentValue = (
				typeof value === "function" ? value(previousValue) : value
			) as Value;

			if (currentValue === previousValue) {
				return previousValue;
			}
			this.#state.set(key, currentValue);

			if (!this.#pendingUpdate) {
				this.#pendingUpdate = true;
				requestAnimationFrame(() => {
					this.#pendingUpdate = false;
					this.#render();
				});
			}

			return currentValue;
		}

		getState<Value>(key: string) {
			return this.#state.get(key) as Value;
		}

		hasState(key: string) {
			return this.#state.has(key);
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

			todo: hash functions needs to handle more cases (fn, obj, sets, maps, etc)
			todo: try hashes as stable keys for list items 

			todo: Attributes need to handle event listeners, boolean values, null/undefined
			todo: Tags need to handle different types, incl. null/undefined

			todo: ContentHole etc have a different structure then the htmlTemplate. Is this an issue?

			todo: css needs a similar treatment like the html template
			=> dont combine the index with the dynamic values, just pass the two together

			todo: we need the lifecycle functions
			todo: we need more of the watchers and state functions (root, emit, async)

			? do we need something like useRef? 

			todo: does the MO needs disconnecting? What else is required for cleanup?

			todo: error handling
		
		*/
		#render() {
			try {
				instance.current = this;
				const template = renderFn(Object.fromEntries(this.#props));
				instance.current = null;

				if (!this.#renderTemplate) {
					const fragment = new DocumentFragment();
					const placeholder = document.createElement("div");
					fragment.append(placeholder);
					this.#renderTemplate = new ContentHole(0, [template], placeholder);
					this.shadowRoot?.replaceChildren(fragment);

					return;
				}

				this.#renderTemplate.update([template]);
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
