import "./rendering/parser-css";
import { html } from "./rendering/parser-html";
import { HTMLTemplate } from "./rendering/template";
import { instance } from "./state/state";
import { BaseComponent, ComponentProps } from "./types";

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, renderFn, options = {}) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#state = new Map<string, unknown>();
		#renderTemplate: HTMLTemplate | null = null;
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

			### structure ###

			todo: css needs a similar treatment like the html template
			=> dont combine the index with the dynamic values, just pass the two together

			todo: attribute boolean values need some kind of storage / cache / mapping
			? we could think about storing the dynamic data (old and new) on the web component class and passing that around as context
			=> that way we could also include abortControllers, setters etc

			todo: holes need to be able to handle async values. If we see them, we should return undefined first but rerender when the value has resolved

			todo: hash functions needs to handle more cases (fn, obj, sets, maps, etc)
			todo: try hashes as stable keys for list items 

			todo: Tags need to handle different types, incl. null/undefined

			todo: if templates have no dynamic holes, we can shortcut 

			### api design ###

			todo: rework state to use the (key, callback, option) signature
			=> we need state, set, watch, track
			=> html templates likely need an array of tracked global keys

			todo: add further helper
			=> emit, on, host

			? do we need something like useRef? 
			=> no as it would be too close to state

			todo: we need the lifecycle functions


			### future

			? if the component gets pre-rendered, can we get to the updatable holes again without re-rendering everything again? 
			=> we would need to encode the bindings in the comments somehow

		
		*/
		#render() {
			try {
				instance.current = this;
				let template = renderFn(Object.fromEntries(this.#props));
				if (!(template instanceof HTMLTemplate)) {
					template = html`${template}`;
				}
				instance.current = null;

				if (
					!this.#renderTemplate ||
					this.#renderTemplate.templateResult.templateHash !==
						template.templateResult.templateHash
				) {
					this.shadowRoot?.replaceChildren(template.setup());
					return;
				}
				this.#renderTemplate.update(template.currentValues);
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
