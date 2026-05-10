import { html } from "./parser/html";
import { ValueOf } from "./parser/types";
import { applyAttributeBinding } from "./rendering/attribute";
import { HTMLTemplate } from "./rendering/template-html";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentGenerator,
	ComponentOptions,
	RenderFunction,
} from "./types";
import { isGeneratorFunction } from "./utils/is-generator";
import {
	advanceGenerator,
	cancelGenerator,
	GeneratorTemplateSource,
	TemplateSource,
	throwIntoGenerator,
} from "./rendering/generator-stepper";
import {
	defaultOptions,
	RENDER_MODE,
	TEMPLATE_SOURCE_TYPE,
	UPDATE_STATE,
} from "./utils/constants";

export { html } from "./parser/html";
export { props } from "./validator/props";
export { type ComponentOptions, type BaseComponent } from "./types";

export const render = (
	componentGenerator: ComponentGenerator,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#attributeObserver: MutationObserver;
		#renderedTemplate: HTMLTemplate | null = null;
		#componentGenerator: GeneratorTemplateSource | null = null;
		#activeSource: TemplateSource | null = null;
		#updateState: ValueOf<typeof UPDATE_STATE> = UPDATE_STATE.IDLE;
		#renderMode: ValueOf<typeof RENDER_MODE> = RENDER_MODE.CSR;

		constructor() {
			super();
			if (this.shadowRoot) {
				this.#renderMode = RENDER_MODE.SSR;
			} else {
				this.attachShadow(options);
			}
		}

		connectedCallback() {
			if (this.#componentGenerator) {
				//prevents re-rendering everything when this element is moved
				return;
			}

			const generator = componentGenerator(this);
			const source: GeneratorTemplateSource = {
				type: TEMPLATE_SOURCE_TYPE.GENERATOR,
				createGenerator: componentGenerator,
				generator,
				cleanup: null,
				terminated: false,
			};
			this.#componentGenerator = source;
			this.#watchAttributes();
			advanceGenerator(
				source,
				generator.next(undefined),
				this.#onYield,
				this.#onError,
			);
		}

		async disconnectedCallback() {
			//this callback is also called when moving inside of the dom.
			//By waiting a tick and checking if we are back in the dom, we can avoid false cleanup calls
			await Promise.resolve();
			if (this.isConnected) return;
			this.#attributeObserver?.disconnect();
			this.#teardownActiveSource();
			const source = this.#componentGenerator;
			if (source) {
				cancelGenerator(source);
				source.cleanup?.();
				this.#componentGenerator = null;
			}
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeBinding(this, name, value, oldValue);
			this.update();
		}

		#watchAttributes() {
			this.#attributeObserver?.disconnect();
			this.#attributeObserver = new MutationObserver(() => this.update());
			this.#attributeObserver.observe(this, { attributes: true });
		}

		#onYield = (source: GeneratorTemplateSource, value: unknown): unknown => {
			if (source === this.#componentGenerator) {
				return this.#installSourceFrom(value);
			}
			if (source === this.#activeSource) {
				if (value instanceof HTMLTemplate) {
					this.#renderToDom(value);
					return this;
				}
				if (typeof value === "function") {
					if (isGeneratorFunction(value)) {
						throw new Error(
							"Inner generators cannot yield generator functions",
						);
					}
					const result = (value as RenderFunction)(this);
					this.#renderToDom(result);
					return this;
				}
				return value;
			}
			// Stale yield (e.g. late async resumption from a torn-down inner) — drop.
			return undefined;
		};

		#onError = (error: Error) => {
			const source = this.#componentGenerator;
			if (!source || source.terminated) {
				this.#abortAndShowError(error);
				return;
			}

			const previous = this.#activeSource;
			const handled = throwIntoGenerator(
				source,
				error,
				this.#onYield,
				this.#onError,
			);

			if (!handled) {
				this.#abortAndShowError(error);
				return;
			}

			// Recursive #onError already abort-handled and nulled #componentGenerator.
			if (this.#componentGenerator === null) return;

			// componentGenerator caught and yielded a recovery: #onYield already
			// replaced #activeSource. componentGenerator caught and returned:
			// source.terminated is now true and #activeSource still points at the
			// errored inner. Tear it down silently; #renderedTemplate persists per
			// the error contract.
			if (source.terminated) {
				source.cleanup?.();
				this.#componentGenerator = null;
				if (previous === this.#activeSource) {
					this.#teardownActiveSource();
				}
			}
		};

		#abortAndShowError(error: Error) {
			this.#teardownActiveSource();
			const source = this.#componentGenerator;
			if (source) {
				cancelGenerator(source);
				source.cleanup?.();
				this.#componentGenerator = null;
			}
			console.warn(error);
			//visualizes the error better than just the warning
			this.shadowRoot!.textContent = `${error}`;
		}

		#installSourceFrom(value: unknown): unknown {
			if (value instanceof HTMLTemplate) {
				this.#installStaticSource(value);
			} else if (typeof value === "function") {
				if (isGeneratorFunction(value)) {
					this.#installGeneratorSource(value as ComponentGenerator);
				} else {
					this.#installRenderFunctionSource(value as RenderFunction);
				}
			} else {
				// Pass-through for non-renderable values (e.g. resolved promise
				// values arriving via the inner-yield path from an outer position).
				return value;
			}
			return this;
		}

		// Install methods evaluate user code first (render function call,
		// generator invocation, render to dom) and only assign #activeSource on
		// success. Keeps the "an assigned #activeSource is renderable" invariant
		// clean: a throw in user code propagates without leaving a half-installed
		// state behind.
		#installStaticSource(template: HTMLTemplate) {
			this.#teardownActiveSource();
			this.#renderToDom(template);
			this.#activeSource = { type: TEMPLATE_SOURCE_TYPE.STATIC };
		}

		#installRenderFunctionSource(renderFunction: RenderFunction) {
			const template = renderFunction(this);
			this.#teardownActiveSource();
			this.#renderToDom(template);
			this.#activeSource = {
				type: TEMPLATE_SOURCE_TYPE.RENDER_FUNCTION,
				render: renderFunction,
			};
		}

		#installGeneratorSource(createGenerator: ComponentGenerator) {
			const generator = createGenerator(this);
			this.#teardownActiveSource();
			const source: GeneratorTemplateSource = {
				type: TEMPLATE_SOURCE_TYPE.GENERATOR,
				createGenerator,
				generator,
				cleanup: null,
				terminated: false,
			};
			this.#activeSource = source;
			advanceGenerator(
				source,
				generator.next(undefined),
				this.#onYield,
				this.#onError,
			);
		}

		#teardownActiveSource() {
			const current = this.#activeSource;
			if (current?.type === TEMPLATE_SOURCE_TYPE.GENERATOR) {
				cancelGenerator(current);
				current.cleanup?.();
			}
			this.#activeSource = null;
		}

		#restartGenerator(source: GeneratorTemplateSource) {
			// Order matters: cancelGenerator sets terminated=true so any pending
			// microtasks see staleness. Run cleanup, then reset state, then drive
			// fresh.
			cancelGenerator(source);
			source.cleanup?.();
			source.generator = source.createGenerator(this);
			source.cleanup = null;
			source.terminated = false;
			advanceGenerator(
				source,
				source.generator.next(undefined),
				this.#onYield,
				this.#onError,
			);
		}

		#renderToDom(value: unknown) {
			const template = value instanceof HTMLTemplate ? value : html`${value}`;
			const previousTemplate = this.#renderedTemplate;
			if (
				!previousTemplate ||
				previousTemplate.parsedHTML.templateHash !==
					template.parsedHTML.templateHash
			) {
				this.#renderedTemplate = template;
				if (this.#renderMode === RENDER_MODE.CSR) {
					this.shadowRoot?.replaceChildren(template.setup());
				} else {
					template.hydrate(this.shadowRoot!);
					this.#renderMode = RENDER_MODE.CSR;
				}
				return;
			}
			previousTemplate.update(template.currentExpressions);
		}

		async update() {
			if (
				!this.#activeSource ||
				this.#updateState !== UPDATE_STATE.IDLE ||
				!this.isConnected
			) {
				return;
			}
			this.#updateState = UPDATE_STATE.SCHEDULED;
			//wait to batch repeated update calls
			await Promise.resolve();
			this.#updateState = UPDATE_STATE.RENDERING;

			try {
				const active = this.#activeSource;
				if (active) {
					switch (active.type) {
						case TEMPLATE_SOURCE_TYPE.STATIC:
							break;
						case TEMPLATE_SOURCE_TYPE.RENDER_FUNCTION:
							this.#renderToDom(active.render(this));
							break;
						case TEMPLATE_SOURCE_TYPE.GENERATOR:
							this.#restartGenerator(active);
							break;
					}
				}
			} catch (error) {
				this.#onError(error as Error);
			} finally {
				// finally so a throw from #onError (e.g. through throwIntoGenerator
				// re-entering user code) cannot leave updateState wedged
				// non-IDLE, which would make every future update() a no-op.
				this.#updateState = UPDATE_STATE.IDLE;
			}
		}
	}

	return BaseElement;
};
