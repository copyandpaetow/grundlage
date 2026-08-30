import { getFormAssociatedBaseClass } from "./forms";
import {
	applyAttributeValue,
	isDeclaredPropName,
} from "./rendering/bindings/attribute-write";

import {
	commitLiveBinding,
	createLiveBinding,
	revertHostBinding,
} from "./rendering/bindings/dispatch";
import { StyleSheetMoveState } from "./rendering/bindings/types";
import { getParsedTemplate } from "./parser/html";
import { flushHostPayload, warnOnUnclaimedSsrPayloads } from "./load";
import { coerceToTemplate, TemplateValue } from "./template";
import {
	canRerender,
	cancelRenderRun,
	createRenderRun,
	endRunWithFatalError,
	hasStarted,
	mountComponentGenerator,
	RenderRun,
	scheduleUpdate,
} from "./runtime/driver";
import { html as htmlValue } from "./template";
import {
	hydrateInstance,
	Instance,
	isPatchableInPlace,
	mountInstance,
	patchInstance,
	refreshStyleSheetsAfterMove,
} from "./rendering/instance";
import { DEFER_HYDRATION_ATTRIBUTE } from "./rendering/constants";
import { releaseDeferredChildren } from "./rendering/defer-hydration";
import { warnOnRejectedServerRange } from "./rendering/markers";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentGenerator,
	ComponentOptions,
	ComponentProps,
	Schema,
	Template,
} from "./types";
import {
	assertPropNamesAreAvailable,
	normalizeSchema,
	Prop,
} from "./props/schema";
import {
	attributeSpellingOf,
	createComponentProps,
	PropValues,
	recoverPreUpgradeAssignments,
	writeProp,
} from "./props/values";
import { isGeneratorFunction, isServer } from "./utils/guards";

export { props } from "./props/read";
export {
	type BaseComponent,
	type ComponentOptions,
	type ComponentProps,
	type Resolve,
	type Schema,
	type Template,
} from "./types";
export { load, type LoadOptions } from "./load";

const alreadySettled = Promise.resolve();

const defaultOptions = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
} as const satisfies ComponentOptions;

export const html = htmlValue as unknown as (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => Template;

export const component = <DeclaredSchema extends Schema = {}>(
	componentGenerator: ComponentGenerator<DeclaredSchema>,
	options: ComponentOptions<DeclaredSchema> = defaultOptions,
): ComponentConstructor => {
	if (!isGeneratorFunction(componentGenerator))
		throw new TypeError(
			"grundlage: component(fn) expects a generator function.",
		);
	const mergedOptions = { ...defaultOptions, ...options };
	const ParentClass: typeof HTMLElement = mergedOptions.formAssociated
		? getFormAssociatedBaseClass()
		: HTMLElement;

	const props = normalizeSchema(mergedOptions.props ?? {});

	class BaseElement extends ParentClass implements BaseComponent {
		static observedAttributes = [...props.keys(), DEFER_HYDRATION_ATTRIBUTE];
		static declaredPropNames: ReadonlySet<string> = new Set(
			[...props.values()].map((prop) => prop.propName),
		);

		#shadowRoot: ShadowRoot; //needs to be property as for mode: "closed" the this.shadowRoot is null
		#instance: Instance | null = null;
		#isHydrationPending: boolean;
		#styleSheetMoveState: StyleSheetMoveState = {
			needsStyleSheetRefreshOnMove: false,
		};
		#internals: ElementInternals | null = null;
		#isWritingHostBindings = false;
		#props: PropValues = createComponentProps(props, this);
		#isReflecting = false;
		#renderRun: RenderRun = createRenderRun({
			host: this,
			componentProps: this.#props as unknown as ComponentProps,
			componentGenerator: componentGenerator as ComponentGenerator,
			paint: (value) => this.#paint(value),
			displayFatalError: (error) => this.#displayFatalError(error),
		});

		get internals(): ElementInternals | null {
			return (this.#internals ??= this.attachInternals?.() ?? null);
		}

		static {
			assertPropNamesAreAvailable(this.prototype, props);
			for (const [attributeName, prop] of props)
				Object.defineProperty(this.prototype, prop.propName, {
					enumerable: true,
					configurable: true,
					get(this: BaseElement) {
						return this.#props[prop.propName];
					},
					set(this: BaseElement, incoming: unknown) {
						if (!writeProp(this.#props, prop, incoming)) return;
						this.#reflect(attributeName, prop);
						this.update();
					},
				});
		}

		#reflect(attributeName: string, prop: Prop): void {
			const spelling = attributeSpellingOf(prop, this.#props[prop.propName]);
			if (spelling === null) {
				if (!this.hasAttribute(attributeName)) return;
				this.#isReflecting = true;
				this.removeAttribute(attributeName);
				this.#isReflecting = false;
				return;
			}
			if (this.getAttribute(attributeName) === spelling) return;
			this.#isReflecting = true;
			this.setAttribute(attributeName, spelling);
			this.#isReflecting = false;
		}

		constructor() {
			super();
			const existingRoot =
				this.shadowRoot ??
				(mergedOptions.mode === "closed" ? this.internals?.shadowRoot : null) ??
				null;
			this.#isHydrationPending = existingRoot !== null;
			this.#shadowRoot = existingRoot ?? this.attachShadow(mergedOptions);
		}

		connectedCallback() {
			if (hasStarted(this.#renderRun)) {
				if (this.#instance) refreshStyleSheetsAfterMove(this.#instance);
				return;
			}
			try {
				recoverPreUpgradeAssignments(this, props);
			} catch (error) {
				return endRunWithFatalError(this.#renderRun, error);
			}
			//the server writes the mark while the child sits in the parent's detached fragment, so
			//it is already present when that fragment is connected and the child paints its own run
			const waitsForTheParentThatOwesItAValue =
				!isServer() && this.hasAttribute(DEFER_HYDRATION_ATTRIBUTE);
			if (waitsForTheParentThatOwesItAValue) return;
			mountComponentGenerator(this.#renderRun);
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (this.isConnected) return;
			if (!hasStarted(this.#renderRun)) return;
			cancelRenderRun(this.#renderRun);
		}

		attributeChangedCallback(
			attributeName: string,
			oldValue: string | null,
			newValue: string | null,
		) {
			if (this.#isReflecting) return;
			if (oldValue === newValue) return;
			if (attributeName === DEFER_HYDRATION_ATTRIBUTE) {
				//upgrade replays a present attribute as null → "" and must not mount; the parent's
				//release removes it as "" → null and must
				const parentHasSuppliedItsValues =
					newValue === null && !hasStarted(this.#renderRun) && this.isConnected;
				if (parentHasSuppliedItsValues)
					mountComponentGenerator(this.#renderRun);
				return;
			}
			const prop = props.get(attributeName);
			if (prop === undefined) return;
			if (writeProp(this.#props, prop, newValue)) this.update();
		}

		setProp(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeValue(this, name, value, oldValue);
			const nothingElseWillScheduleThisWrite = !isDeclaredPropName(this, name);
			if (nothingElseWillScheduleThisWrite) this.update();
		}

		update(): Promise<void> {
			//four paths reach here from inside a host-binding write; this is the one funnel
			if (this.#isWritingHostBindings) return alreadySettled;
			if (!canRerender(this.#renderRun)) return alreadySettled;
			return scheduleUpdate(this.#renderRun);
		}

		#displayFatalError(error: unknown): void {
			console.warn(error);
			this.#shadowRoot.textContent = `${error}`;
			this.#revertAllHostBindings();
			this.#instance = null;
		}

		#paint(value: unknown): void {
			const templateValue = coerceToTemplate(value);

			if (this.#isHydrationPending) {
				if (!this.#hydrateRoot(templateValue)) {
					warnOnRejectedServerRange();
					this.#paintRoot(templateValue);
				}
				this.#isHydrationPending = false;
				warnOnUnclaimedSsrPayloads(this.#shadowRoot);
				releaseDeferredChildren(this.#shadowRoot);
			} else {
				this.#paintRoot(templateValue);
			}
			//the run's latched value, not a fresh isServer(): the global is mutable and the paint
			//must agree with the driver that scheduled it
			if (this.#renderRun.isServerRun) flushHostPayload(this);
		}

		//the revert reads #instance, which is still the outgoing one here and null on a first paint,
		//and it can write host attributes — so it belongs inside the flag
		#writeHostBindings(instance: Instance, values: Array<unknown>): void {
			this.#isWritingHostBindings = true;
			try {
				this.#revertAllHostBindings();
				const { bindings, hostBindingCount } = instance.parsed;
				for (let index = 0; index < hostBindingCount; index++) {
					const live = createLiveBinding(bindings[index], this);
					commitLiveBinding(instance, live, values);
					instance.liveBindings[index] = live;
				}
			} finally {
				this.#isWritingHostBindings = false;
			}
		}

		#paintRoot(value: TemplateValue): void {
			const current = this.#instance;
			const parsed = getParsedTemplate(value.__templateStrings);
			if (isPatchableInPlace(current, parsed)) {
				patchInstance(current, value.values);
				return;
			}
			const { instance, fragment } = mountInstance(
				value,
				this.#styleSheetMoveState,
			);
			this.#writeHostBindings(instance, value.values);
			this.#shadowRoot.replaceChildren(fragment);
			this.#instance = instance;
		}

		#hydrateRoot(value: TemplateValue): boolean {
			const instance = hydrateInstance(
				document.createTreeWalker(this.#shadowRoot, NodeFilter.SHOW_COMMENT),
				value,
				null,
				this.#styleSheetMoveState,
			);
			if (instance === null) return false;
			this.#writeHostBindings(instance, value.values);
			this.#instance = instance;
			return true;
		}

		#revertAllHostBindings(): void {
			const instance = this.#instance;
			if (!instance) return;
			const liveBindings = instance.liveBindings;
			for (let index = 0; index < instance.parsed.hostBindingCount; index++)
				revertHostBinding(liveBindings[index]);
		}
	}

	return BaseElement;
};
