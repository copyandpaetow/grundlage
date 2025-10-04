import { BindingResult, type Result } from "./html/html";
import "./css/css";

interface BaseComponent extends HTMLElement {
	setState<Value>(key: string, value: Value): Value;
	getState<Value>(key: string): Value;
	hasState(key: string): boolean;
}

let instance: BaseComponent | null = null;

export const useState = <Value extends unknown>(
	name: string,
	initialValue: Value,
	options?: {}
) => {
	if (!instance) {
		throw new Error("instance is not defined");
	}

	const currentInstance = instance;
	const camelCaseName = name[0].toUpperCase() + name.slice(1);
	const lowerCaseName = name.toLowerCase();
	const currentValue = currentInstance.hasState(name)
		? currentInstance.getState(name)
		: currentInstance.setState(name, initialValue);

	return {
		[lowerCaseName]: currentValue,
		[`set${camelCaseName}`]: <Value>(newValue: Value) =>
			currentInstance.setState(name, newValue),
	};
};

export type DynamicPart = BindingResult & {
	start: Comment;
	end: Comment;
};

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
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#state = new Map<string, unknown>();
		#dynamicParts: Array<DynamicPart> | null = null;
		#dirty: Set<DynamicPart> = new Set();
		#update = -1;

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

			todo: we need the lifecycle functions
			todo: we need more of the watchers and state functions (root, emit, async)

			? do we need something like useRef? 

			todo: does the MO needs disconnecting? What else is required for cleanup?

			todo: error handling
		
		*/
		#render() {
			try {
				console.time("parse");
				instance = this;
				const result = renderFn(Object.fromEntries(this.#props));
				instance = null;
				console.timeEnd("parse");

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

		#renderDom(result: Result, shadowRoot: ShadowRoot): Array<DynamicPart> {
			const dynamicParts = result.bindings.map((currentBinding, index) => {
				const updatedBindings = {
					...currentBinding,
					start: new Comment(),
					end: new Comment(),
				};

				const placeholder = result.fragment.querySelector(
					`[data-replace-${index}]`
				)!;
				placeholder?.removeAttribute(`data-replace-${index}`);

				switch (updatedBindings.type) {
					case "ATTR":
						placeholder.append(updatedBindings.start, updatedBindings.end);
						this.#updateAttr(updatedBindings);
						return updatedBindings;
					case "TAG":
						placeholder.before(updatedBindings.start);
						placeholder.after(updatedBindings.end);
						this.#updateTag(updatedBindings);
						return updatedBindings;
					case "TEXT":
						placeholder.replaceWith(updatedBindings.start, updatedBindings.end);
						this.#updateText(updatedBindings);
						return updatedBindings;

					default:
						return updatedBindings;
				}
			});

			shadowRoot.replaceChildren(result.fragment);

			return dynamicParts;
		}

		#updateDom(dirtyBindings: Set<DynamicPart>) {
			dirtyBindings.forEach((binding) => {
				switch (binding.type) {
					case "ATTR":
						this.#updateAttr(binding);
						break;
					case "TAG":
						this.#updateTag(binding);
						break;
					case "TEXT":
						this.#updateText(binding);
						break;

					default:
						break;
				}
			});
		}

		#hasDynamicPartChanged(currentPart: DynamicPart, newPart: BindingResult) {
			const { value, key } = currentPart;

			let hasChanged = false;

			value.forEach((currentValue, index) => {
				if (newPart.value[index] === currentValue) {
					return;
				}
				value[index] = newPart.value[index];
				hasChanged = true;
			});

			key.forEach((currentKey, index) => {
				if (newPart.key[index] === currentKey) {
					return;
				}
				key[index] = newPart.key[index];
				hasChanged = true;
			});

			return hasChanged;
		}

		#updateTag(currentBinding: DynamicPart) {
			const placeholder = currentBinding.start.nextElementSibling!;
			const newTag = currentBinding.value.join(""); //functions in here would need to get called

			const newElement = document.createElement(newTag);
			placeholder
				.getAttributeNames()
				.forEach((name) =>
					newElement.setAttribute(name, placeholder.getAttribute(name)!)
				);

			newElement.replaceChildren(...placeholder.childNodes);

			let current = currentBinding.start.nextSibling;
			while (current && current !== currentBinding.end) {
				const next = current.nextSibling;
				current.remove();
				current = next;
			}

			currentBinding.start.after(newElement);
		}

		#updateAttr(currentBinding: DynamicPart) {
			const key = currentBinding.key.join("");
			const value = currentBinding.value.join("");

			currentBinding.start.parentElement!.setAttribute(key, value);
		}

		#updateText(currentBinding: DynamicPart) {
			const text = currentBinding.value.join("");
			const textNode = document.createTextNode(text);

			let current = currentBinding.start.nextSibling;
			while (current && current !== currentBinding.end) {
				const next = current.nextSibling;
				current.remove();
				current = next;
			}
			currentBinding.start.after(textNode);
		}
	}

	if (!customElements?.get(name)) {
		customElements.define(name, BaseElement);
	}

	// return (currentProps = {}) => {
	// 	return html`<${name} ${currentProps}></${name}>`;
	// };
};
