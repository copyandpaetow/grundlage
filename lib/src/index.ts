import "./css/css";
import { BaseComponent, ComponentProps, Holes } from "./types";
import { TemplateResult } from "./html/html";
import { instance } from "./state/state";
import { updateAttr } from "./update/attributes";
import { updateTag } from "./update/tags";
import { updateText } from "./update/content";

//@ts-expect-error options will come soon
export const render: ComponentProps = (name, renderFn, options = {}) => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#props = new Map<string, unknown>();
		#observer: MutationObserver;
		#state = new Map<string, unknown>();
		#holes: Holes | null = null;
		#lastDynamicValues: Array<unknown> = [];
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
		  *baseline
			- maybe the html function also needs to return a hash after all
				=> we still need a key for lists and might not need the sets of the comparision function
			- linked list needed for holes iteration?
			- static and reactive updating are very similar, that is duplicated code
			- comparing dynamic values creates sets that gets thrown away 
			- types and names need to be replaced by enums
			- reduce code
				- template check could be a function


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

				if (!this.#holes) {
					this.#holes = this.#renderDom(result, this.shadowRoot!);

					this.#lastDynamicValues = result.dynamicValues;
					return;
				}

				const changedValues = this.#compareDynamicValues(
					result.dynamicValues,
					this.#lastDynamicValues
				);

				attrLoop: for (const attr of this.#holes!.attributeUpdates) {
					if (attr.dirty) {
						continue;
					}
					for (const value of attr.values) {
						if (changedValues.has(value)) {
							attr.dirty = true;
							continue attrLoop;
						}
					}
					for (const value of attr.keys) {
						if (changedValues.has(value)) {
							attr.dirty = true;
							continue attrLoop;
						}
					}
				}

				tagLoop: for (const tag of this.#holes!.tagUpdates) {
					if (tag.dirty) {
						continue;
					}
					for (const value of tag.values) {
						if (changedValues.has(value)) {
							tag.dirty = true;
							continue tagLoop;
						}
					}
				}

				for (const content of this.#holes!.contentUpdates) {
					if (content.dirty) {
						continue;
					}

					if (changedValues.has(content.values)) {
						content.dirty = true;
						continue;
					}
				}

				cancelAnimationFrame(this.#update);
				this.#update = requestAnimationFrame(() => {
					this.#updateDom(this.#holes!, result.dynamicValues);
					this.#lastDynamicValues = result.dynamicValues;
				});
			} catch (error) {
				console.error(error);
				this.shadowRoot!.innerHTML = `${error}`;
			}
		}

		//TODO: that works but we are creating sets that are thrown away
		#compareDynamicValues(current: Array<unknown>, previous: Array<unknown>) {
			const changedValues = new Set();

			for (let index = 0; index < current.length; index++) {
				if (current[index] === previous[index]) {
					continue;
				}
				if (
					current[index]?.__type__ === "template" &&
					current[index]?.__type__ === previous[index]?.__type__ &&
					this.#compareDynamicValues(
						current[index].dynamicValues,
						previous[index].dynamicValues
					).size === 0
				) {
					continue;
				}

				changedValues.add(index);
			}

			return changedValues;
		}

		#renderDom(
			result: TemplateResult,
			target: ShadowRoot | HTMLElement
		): Holes {
			const fragment = result.fragment.cloneNode(true) as DocumentFragment; //the fragment is being lazily cloned so we need to do that here once

			const contentUpdates = result.contentBinding.map(
				(contentIndex, index) => {
					const placeholder = fragment.querySelector(
						`[data-content-replace-${index}]`
					)!;

					const updatedBindings = {
						values: contentIndex,
						start: new Comment("content"),
						end: new Comment("content"),
						dirty: false,
					};

					placeholder.replaceWith(updatedBindings.start, updatedBindings.end);
					updateText(updatedBindings, result.dynamicValues);

					return updatedBindings;
				}
			);

			const tagUpdates = result.tagBinding.map((tagContent, index) => {
				const placeholder = fragment.querySelector(
					`[data-tag-replace-${index}]`
				)!;
				placeholder?.removeAttribute(`data-tag-replace-${index}`);

				const updatedBindings = {
					values: tagContent.values,
					start: new Comment("tag"),
					dirty: false,
				};

				placeholder.prepend(updatedBindings.start);
				updateTag(updatedBindings, result.dynamicValues);

				return updatedBindings;
			});

			const attributeUpdates = result.attrBinding.map((tagContent, index) => {
				const placeholder = fragment.querySelector(
					`[data-attr-replace-${index}]`
				)!;
				placeholder?.removeAttribute(`data-attr-replace-${index}`);

				const updatedBindings = {
					values: tagContent.values,
					keys: tagContent.keys,
					start: new Comment("attr"),
					dirty: false,
				};

				placeholder.prepend(updatedBindings.start);
				updateAttr(updatedBindings, result.dynamicValues);

				return updatedBindings;
			});

			target.replaceChildren(fragment);

			return {
				contentUpdates,
				attributeUpdates,
				tagUpdates,
			};
		}

		#updateDom(holes: Holes, dynamicValues: Array<unknown>) {
			for (const attr of holes.attributeUpdates) {
				if (attr.dirty) {
					updateAttr(attr, dynamicValues);
				}
			}

			for (const content of holes.contentUpdates) {
				if (content.dirty) {
					updateText(content, dynamicValues);
				}
			}

			for (const tag of holes.tagUpdates) {
				if (tag.dirty) {
					updateTag(tag, dynamicValues);
				}
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
