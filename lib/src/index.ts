import { html } from "./parser/html";
import { ValueOf } from "./parser/types";
import { applyAttributeBinding } from "./rendering/attribute";
import { HTMLTemplate } from "./rendering/template-html";
import { BaseComponent, ComponentConstructor, ComponentGenerator, ComponentOptions, RenderFunction } from "./types";
import { isGeneratorFunction } from "./utils/is-generator";
import {
	advanceGenerator,
	cancelGenerator,
	deliverErrorToGenerator,
	GeneratorTemplateSource,
	TemplateSource
} from "./rendering/generator-stepper";
import { defaultOptions, RENDER_MODE, TEMPLATE_SOURCE_TYPE, UPDATE_STATE } from "./utils/constants";
import { flushHostPayload } from "./load-data";
import { isServer } from "./utils/is-server";

export { html } from "./parser/html";
export { props } from "./validator/props";
export { type ComponentOptions, type BaseComponent } from "./types";
export { loadData, type LoadDataOptions } from "./load-data";

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
				//moving an element in the DOM fires disconnectedCallback then connectedCallback
				//=> if a generator already exists we bail out so the move doesn't restart the component from scratch
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
			//on the server we render once and cancel — no observer needed; #renderToDom guards its disconnect/observe with optional chaining to match
			if (!isServer()) this.#watchAttributes();
			advanceGenerator(
				source,
				generator.next(undefined),
				this.#onYield,
				this.#onError,
			);
		}

		async disconnectedCallback() {
			//this callback is also called when moving inside the dom.
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
			//if we reach this point the yield came from a generator we no longer track (e.g. an async generator that was torn down but later resumes from a pending await)
			//=> by returning undefined the value never reaches the dom
		};

		#onError = (error: Error) => {
			const source = this.#componentGenerator;
			if (!source || source.terminated) {
				this.#abortAndShowError(error);
				return;
			}

			const previous = this.#activeSource;
			deliverErrorToGenerator(source, error, this.#onYield, this.#onError);

			//deliverErrorToGenerator above can re-enter this same #onError if the error keeps escaping
			//=> if that recursion has already aborted everything and nulled #componentGenerator, there's nothing left for us to do
			if (this.#componentGenerator === null) return;

			/*
			otherwise the component generator's try/catch saw the error and reacted in one of two ways:
			- it yielded a new template (a recovery) => #onYield has already swapped #activeSource over for us
			- it ran a `return` (or fell off the end), which marks source.terminated and leaves #activeSource pointing at the inner that just errored => we tear that inner down silently
			the previous frame's dom (#renderedTemplate) stays put either way — that's the error contract we promise users
			*/
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
			//we also write the error into the shadow root so it's more visible than just the console warning
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
				//the outer generator yielded something that isn't a template, render function, or generator
				//=> we hand the value straight back as the result of its `yield` expression (e.g. the resolved value of a yielded Promise)
				return value;
			}
			return this;
		}

		/*
		the install methods evaluate user code first (render function call, generator invocation, render to dom) and only assign #activeSource on success
		=> we keep the "an assigned #activeSource is renderable" invariant clean: a throw in user code propagates without leaving a half-installed state behind
		*/
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
			//advanceGenerator queues microtasks whenever a generator yields a Promise
			//=> cancelGenerator first marks terminated=true so any of those pending microtasks bail out instead of resuming the old generator
			//then we run cleanup, reset the source, and drive a fresh generator
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
			const onServer = isServer();

			//bracket the observer only when this render could write to the host (swap cleanup or new host bindings); components without root templates pay nothing
			//on the server the observer was never installed, so `touchesHost` short-circuits to false
			const touchesHost =
				!onServer &&
				(template.parsedHTML.hostBindingOffset > 0 ||
					(previousTemplate?.parsedHTML.hostBindingOffset ?? 0) > 0);

			//disconnecting empties the record queue per spec, so framework-driven host writes during this synchronous block never generate MutationRecords
			//the bracket scope is purely synchronous, so no user code can run in the gap and lose a legitimate mutation
			if (touchesHost) this.#attributeObserver?.disconnect();
			try {
				if (
					!previousTemplate ||
					previousTemplate.parsedHTML.templateHash !==
						template.parsedHTML.templateHash
				) {
					//host bindings write to the component element itself, so replaceChildren below won't clear them
					//=> the previous template knows which host attribute names it applied (and how to remove them across every binding form); we delegate cleanup before letting setup() write the new template's host attrs
					previousTemplate?.clearHostAttributes(this);
					this.#renderedTemplate = template;
					if (this.#renderMode === RENDER_MODE.CSR) {
						this.shadowRoot?.replaceChildren(template.setup(this));
					} else {
						template.hydrate(this);
						this.#renderMode = RENDER_MODE.CSR;
					}

					if (onServer) this.#finalizeServerRender();
					return;
				}
				previousTemplate.update(template.currentExpressions);
			} finally {
				if (touchesHost) {
					this.#attributeObserver?.observe(this, { attributes: true });
				}
			}
		}

		//server contract: first renderable yield is the snapshot — flush any collected loadData payload onto the shadow root, then cancel both the active inner source and the outer component generator
		//we discard the cleanup return value: server context is throwaway, and user finally blocks under happy-dom can touch browser-only APIs that aren't polyfilled
		#finalizeServerRender() {
			flushHostPayload(this);
			if (this.#activeSource?.type === TEMPLATE_SOURCE_TYPE.GENERATOR) {
				cancelGenerator(this.#activeSource);
			}
			if (this.#componentGenerator) {
				cancelGenerator(this.#componentGenerator);
			}
		}

		async update() {
			//on the server the first yield is final; without this guard the cached RENDER_FUNCTION source would re-run, and a user microtask scheduling update() from inside the render fn would loop forever
			if (
				isServer() ||
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
				//#onError can re-enter user code (via deliverErrorToGenerator throwing into the generator) and that user code can throw again
				//=> we reset updateState in finally so a throw on the way out can't leave it stuck non-IDLE, which would make every future update() bail at the guard above
				this.#updateState = UPDATE_STATE.IDLE;
			}
		}
	}

	return BaseElement;
};
