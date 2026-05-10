import { html } from "./parser/html";
import { props as propHelper, Schema } from "./validator/props";
import { ValueOf } from "./parser/types";
import { applyAttributeBinding } from "./rendering/attribute";
import { HTMLTemplate } from "./rendering/template-html";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentOptions,
	GeneratorFn,
	TemplateRenderer,
} from "./types";
import { isGeneratorFunction } from "./utils/is-generator";
import {
	cancel,
	drive,
	Epoch,
	GeneratorEpoch,
	throwInto,
} from "./rendering/generator-driver";
import {
	defaultOptions,
	EPOCH_TYPE,
	RENDER_MODE,
	UPDATE_STATE,
} from "./utils/constants";

export { html } from "./parser/html";
export { props } from "./validator/props";
export { type ComponentOptions, type BaseComponent } from "./types";

export const render = (
	componentGenerator: GeneratorFn,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	class BaseElement extends HTMLElement implements BaseComponent {
		#observer: MutationObserver;
		#view: HTMLTemplate | null = null;
		#outer: GeneratorEpoch | null = null;
		#active: Epoch | null = null;
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
			if (this.#outer) {
				//prevents re-rendering everything when this element is moved
				return;
			}

			const generator = componentGenerator(this);
			const outer: GeneratorEpoch = {
				type: EPOCH_TYPE.GENERATOR,
				generatorFn: componentGenerator,
				generator,
				cleanup: null,
				done: false,
			};
			this.#outer = outer;
			this.#watchAttributes();
			drive(
				outer,
				generator.next(undefined),
				this.#handleYield,
				this.#handleError,
			);
		}

		async disconnectedCallback() {
			//this callback is also called when moving inside of the dom.
			//By waiting a tick and checking if we are back in the dom, we can avoid false cleanup calls
			await Promise.resolve();
			if (this.isConnected) return;
			this.#observer?.disconnect();
			this.#tearDownActive();
			const outer = this.#outer;
			if (outer) {
				cancel(outer);
				outer.cleanup?.();
				this.#outer = null;
			}
		}

		setProperty(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeBinding(this, name, value, oldValue);
			this.update();
		}

		props(schema: Schema) {
			propHelper(this, schema);
		}

		#watchAttributes() {
			this.#observer?.disconnect();
			this.#observer = new MutationObserver(() => this.update());
			this.#observer.observe(this, { attributes: true });
		}

		#handleYield = (epoch: GeneratorEpoch, value: unknown): unknown => {
			if (epoch === this.#outer) {
				return this.#installActiveFromYield(value);
			}
			if (epoch === this.#active) {
				if (value instanceof HTMLTemplate) {
					this.#commit(value);
					return this;
				}
				if (typeof value === "function") {
					if (isGeneratorFunction(value)) {
						throw new Error(
							"Inner generators cannot yield generator functions",
						);
					}
					const result = (value as TemplateRenderer)(this);
					this.#commit(result);
					return this;
				}
				return value;
			}
			// Stale yield (e.g. late async resumption from a torn-down inner) — drop.
			return undefined;
		};

		#handleError = (error: Error) => {
			const outer = this.#outer;
			if (!outer || outer.done) {
				this.#terminal(error);
				return;
			}

			const preActive = this.#active;
			const handled = throwInto(
				outer,
				error,
				this.#handleYield,
				this.#handleError,
			);

			if (!handled) {
				this.#terminal(error);
				return;
			}

			// Recursive handleError already terminal-handled and nulled #outer.
			if (this.#outer === null) return;

			// Outer caught and yielded a recovery: handleYield already replaced
			// #active. Outer caught and returned: outer.done is now true and
			// #active still points at the errored inner. Tear it down silently;
			// #view persists per the error contract.
			if (outer.done) {
				outer.cleanup?.();
				this.#outer = null;
				if (preActive === this.#active) {
					this.#tearDownActive();
				}
			}
		};

		#terminal(error: Error) {
			this.#tearDownActive();
			const outer = this.#outer;
			if (outer) {
				cancel(outer);
				outer.cleanup?.();
				this.#outer = null;
			}
			console.warn(error);
			//visualizes the error better than just the warning
			this.shadowRoot!.textContent = `${error}`;
		}

		#installActiveFromYield(value: unknown): unknown {
			if (value instanceof HTMLTemplate) {
				this.#installStatic(value);
			} else if (typeof value === "function") {
				if (isGeneratorFunction(value)) {
					this.#installGenerator(value as GeneratorFn);
				} else {
					this.#installRenderer(value as TemplateRenderer);
				}
			} else {
				// Pass-through for non-renderable values (e.g. resolved promise
				// values arriving via the inner-yield path from an outer position).
				return value;
			}
			return this;
		}

		// Install methods evaluate user code first (renderer call, generator
		// invocation, commit) and only assign #active on success. Keeps the
		// "an installed #active is renderable" invariant clean: a throw in user
		// code propagates without leaving a half-installed active behind.
		#installStatic(template: HTMLTemplate) {
			this.#tearDownActive();
			this.#commit(template);
			this.#active = { type: EPOCH_TYPE.STATIC };
		}

		#installRenderer(renderer: TemplateRenderer) {
			const template = renderer(this);
			this.#tearDownActive();
			this.#commit(template);
			this.#active = { type: EPOCH_TYPE.RENDERER, renderer };
		}

		#installGenerator(generatorFn: GeneratorFn) {
			const generator = generatorFn(this);
			this.#tearDownActive();
			const epoch: GeneratorEpoch = {
				type: EPOCH_TYPE.GENERATOR,
				generatorFn,
				generator,
				cleanup: null,
				done: false,
			};
			this.#active = epoch;
			drive(
				epoch,
				generator.next(undefined),
				this.#handleYield,
				this.#handleError,
			);
		}

		#tearDownActive() {
			const current = this.#active;
			if (current?.type === EPOCH_TYPE.GENERATOR) {
				cancel(current);
				current.cleanup?.();
			}
			this.#active = null;
		}

		#restartGenerator(epoch: GeneratorEpoch) {
			// Order matters: cancel sets done=true so any pending microtasks see
			// staleness. Run cleanup, then reset state, then drive fresh.
			cancel(epoch);
			epoch.cleanup?.();
			epoch.generator = epoch.generatorFn(this);
			epoch.cleanup = null;
			epoch.done = false;
			drive(
				epoch,
				epoch.generator.next(undefined),
				this.#handleYield,
				this.#handleError,
			);
		}

		#commit(value: unknown) {
			const template = value instanceof HTMLTemplate ? value : html`${value}`;
			const previousView = this.#view;
			if (
				!previousView ||
				previousView.parsedHTML.templateHash !==
					template.parsedHTML.templateHash
			) {
				this.#view = template;
				if (this.#renderMode === RENDER_MODE.CSR) {
					this.shadowRoot?.replaceChildren(template.setup());
				} else {
					template.hydrate(this.shadowRoot!);
					this.#renderMode = RENDER_MODE.CSR;
				}
				return;
			}
			previousView.update(template.currentExpressions);
		}

		async update() {
			if (
				!this.#active ||
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
				const active = this.#active;
				if (active) {
					switch (active.type) {
						case EPOCH_TYPE.STATIC:
							break;
						case EPOCH_TYPE.RENDERER:
							this.#commit(active.renderer(this));
							break;
						case EPOCH_TYPE.GENERATOR:
							this.#restartGenerator(active);
							break;
					}
				}
			} catch (error) {
				this.#handleError(error as Error);
			} finally {
				// finally so a throw from #handleError (e.g. through throwInto
				// re-entering user code) cannot leave updateState wedged
				// non-IDLE, which would make every future update() a no-op.
				this.#updateState = UPDATE_STATE.IDLE;
			}
		}
	}

	return BaseElement;
};
