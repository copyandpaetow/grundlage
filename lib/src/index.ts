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
	update: VoidFunction;
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
		#inprogres = false;
		#dynamicParts: Array<DynamicPart> | null = null;

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

			todo: we need to extract the rendering function creation 
			todo: we need to account for different kind of values (fn, null, object etc)
			todo: the rendering needs to happen in a requestAnimationframe and the inprogress needs to reflect the promise of it
			=> we need to update the data structure so at the end of the RAF the freshest values are there

			todo: we need the lifecycle functions
			todo: we need more of the watchers and state functions (root, emit, async)

			? do we need something like useRef? 
		
		*/
		#render() {
			try {
				if (this.#inprogres) {
					return;
				}
				this.#inprogres = true;
				console.time("parse");
				instance = this;
				const result = renderFn(Object.fromEntries(this.#props));
				console.log({ result });
				instance = null;
				console.timeEnd("parse");

				if (!this.#dynamicParts) {
					this.#dynamicParts = this.#renderDom(result, this.shadowRoot!);
				}

				this.#dynamicParts.forEach((currentPart, index) => {
					const newPart = result.bindings[index];

					if (this.#hasDynamicPartChanged(currentPart, newPart)) {
						console.log("changed");
						this.#updateDom(this.#dynamicParts!, index, newPart);
					} else {
						console.log("same");
					}
				});
			} catch (error) {
				console.error(error);
				this.shadowRoot!.innerHTML = `${error}`;
			} finally {
				this.#inprogres = false;
			}
		}

		#renderDom(result: Result, shadowRoot: ShadowRoot): Array<DynamicPart> {
			const dynamicParts = result.bindings.map((currentBinding, index) => {
				const start = new Comment();
				const end = new Comment();
				const placeholder = result.fragment.querySelector(
					`[data-replace-${index}]`
				)!;
				placeholder?.removeAttribute(`data-replace-${index}`);

				if (currentBinding.type === "ATTR") {
					placeholder.append(start, end);
					function update(currentBinding: BindingResult) {
						const key = currentBinding.key.join("");
						const value = currentBinding.value.join("");

						start.parentElement!.setAttribute(key, value);
					}

					update(currentBinding);

					return {
						...currentBinding,
						start,
						end,
						update,
					};
				}

				if (currentBinding.type === "TAG") {
					placeholder.before(start);
					placeholder.after(end);
					function update(currentBinding: BindingResult) {
						const newTag = currentBinding.value.join(""); //functions in here would need to get called

						const newElement = document.createElement(newTag);
						placeholder
							.getAttributeNames()
							.forEach((name) =>
								newElement.setAttribute(name, placeholder.getAttribute(name)!)
							);

						newElement.replaceChildren(...placeholder.childNodes);

						let current = start.nextSibling;
						while (current && current !== end) {
							const next = current.nextSibling;
							current.remove();
							current = next;
						}

						start.after(newElement);
					}

					update(currentBinding);

					return {
						...currentBinding,
						start,
						end,
						update,
					};
				}

				placeholder.replaceWith(start, end);

				function update(currentBinding: BindingResult) {
					const text = currentBinding.value.join("");
					const textNode = document.createTextNode(text);

					let current = start.nextSibling;
					while (current && current !== end) {
						const next = current.nextSibling;
						current.remove();
						current = next;
					}
					start.after(textNode);
				}

				update(currentBinding);

				return {
					...currentBinding,
					start,
					end,
					update,
				};
			});

			shadowRoot.replaceChildren(result.fragment);

			return dynamicParts;
		}

		#updateDom(
			dynamicParts: DynamicPart[],
			index: number,
			newPart: BindingResult
		) {
			const { start, end, update } = dynamicParts[index];

			dynamicParts[index] = { ...newPart, start, end, update };
			update(dynamicParts[index]);
		}

		#hasDynamicPartChanged(currentPart: DynamicPart, newPart: BindingResult) {
			const { value, key } = currentPart;

			if (
				value.some(
					(currentValue, index) => newPart.value[index] !== currentValue
				)
			) {
				return true;
			}

			if (key.some((currentKey, index) => newPart.key[index] !== currentKey)) {
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
