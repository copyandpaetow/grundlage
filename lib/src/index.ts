import "./css/css";
import { BaseComponent, ComponentProps, DynamicPart } from "./types";
import { BindingResult, TemplateResult, type Result } from "./html/html";
import { instance } from "./state/state";
import { updateAttr } from "./update/attributes";
import { updateTag } from "./update/tags";
import { updateText } from "./update/texts";

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, renderFn, options = {}) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#state = new Map<string, unknown>();
		#dynamicParts: Array<DynamicPart> | null = null;
		#dirty: Set<DynamicPart> = new Set();
		#update = -1;
		hash: number = -1;

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
			this.#render();
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

			todo: we need to account for different kind of values (fn, null, object etc) 
			=> maybe the updater functions need their own file and own unpack functions

			todo: we need the lifecycle functions
			todo: we need more of the watchers and state functions (root, emit, async)

			? do we need something like useRef? 

			todo: does the MO needs disconnecting? What else is required for cleanup?

			todo: error handling
		
		*/
		#render() {
			try {
				instance.current = this;
				const result = renderFn(Object.fromEntries(this.#props));
				instance.current = null;

				if (this.hash === result.hash) {
					return;
				} else {
					this.hash = result.hash;
				}

				if (!this.#dynamicParts) {
					this.#dynamicParts = this.#renderDom(result, this.shadowRoot!);
					return;
				}

				this.#dynamicParts.forEach((currentPart, index) => {
					const newPart = result.bindings[index];
					if (this.#hasDynamicPartChanged(currentPart, newPart)) {
						this.#dirty.add(currentPart);
					}
				});

				if (this.#dirty.size > 0) {
					cancelAnimationFrame(this.#update);
					this.#update = requestAnimationFrame(() => {
						this.#updateDom(this.#dirty);
					});
				}
			} catch (error) {
				console.error(error);
				this.shadowRoot!.innerHTML = `${error}`;
			}
		}

		#renderDom(
			result: TemplateResult,
			target: ShadowRoot | HTMLElement
		): Array<DynamicPart> {
			const fragment = result.fragment as DocumentFragment; //the fragment is being lazily cloned so we need to do that here once

			const dynamicParts = result.bindings.map((currentBinding, index) => {
				const updatedBindings = {
					...currentBinding,
					start: new Comment(),
					end: new Comment(),
				};

				const placeholder = fragment.querySelector(`[data-replace-${index}]`)!;
				placeholder?.removeAttribute(`data-replace-${index}`);

				switch (updatedBindings.type) {
					case "ATTR":
						placeholder.append(updatedBindings.start, updatedBindings.end);
						updateAttr(updatedBindings);
						return updatedBindings;
					case "TAG":
						placeholder.before(updatedBindings.start);
						placeholder.after(updatedBindings.end);
						updateTag(updatedBindings);
						return updatedBindings;
					case "TEXT":
						placeholder.replaceWith(updatedBindings.start, updatedBindings.end);
						updateText(updatedBindings);
						return updatedBindings;

					default:
						return updatedBindings;
				}
			});

			target.replaceChildren(fragment);

			return dynamicParts;
		}

		#updateDom(dirtyBindings: Set<DynamicPart>) {
			dirtyBindings.forEach((binding) => {
				switch (binding.type) {
					case "ATTR":
						updateAttr(binding);
						break;
					case "TAG":
						updateTag(binding);
						break;
					case "TEXT":
						updateText(binding);
						break;

					default:
						break;
				}
			});
			dirtyBindings.clear();
		}
		#hasDynamicPartChanged(currentPart: DynamicPart, newPart: BindingResult) {
			if (currentPart.hash !== newPart.hash) {
				currentPart.key = newPart.key;
				currentPart.value = newPart.value;
				return true;
			}

			return false;
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	// return (currentProps = {}) => {
	// 	return html`<${name} ${currentProps}></${name}>`;
	// };
};
