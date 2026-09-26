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
import {
	AttributeLaneLiveBinding,
	Instance,
	StyleSheetMoveState,
} from "./rendering/bindings/types";
import { getParsedTemplate } from "./parser/html";
import { flushHostPayload, warnOnUnclaimedSsrPayloads } from "./load";
import { coerceToTemplate, TemplateValue } from "./template";
import {
	alreadySettled,
	createRenderRun,
	endRunWithFatalError,
	RENDER_REQUEST,
	RenderRun,
	requestRender,
} from "./runtime/driver";
import { forgetWhereThisRunSits } from "./runtime/render-order";
import { ComponentErrorEvent } from "./runtime/component-error-event";
import { html as htmlValue } from "./template";
import {
	commitHostBindings,
	hydrateInstance,
	isPatchableInPlace,
	mountInstance,
	patchInstance,
	refreshStyleSheetsAfterMove,
} from "./rendering/instance";
import { DEFER_HYDRATION_ATTRIBUTE } from "./rendering/constants";
import { resolveShadowRoot } from "./rendering/dom";
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
import { isGeneratorFunction } from "./utils/guards";

export { props } from "./props/read";
export {
	type BaseComponent,
	type Cleanup,
	type ComponentOptions,
	type ComponentProps,
	type DeclaredProps,
	type Resolve,
	type Schema,
	type Template,
	type YieldableValue,
} from "./types";
export { load, type LoadOptions } from "./load";
export { ComponentErrorEvent } from "./runtime/component-error-event";

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
): ComponentConstructor<DeclaredSchema> => {
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
			if (this.getAttribute(attributeName) === spelling) return;
			//a settled value with no spelling removes the attribute, and attributeChangedCallback would
			//read that removal back as an absence and resolve it to the fallback
			this.#isReflecting = true;
			if (spelling === null) this.removeAttribute(attributeName);
			else this.setAttribute(attributeName, spelling);
			this.#isReflecting = false;
		}

		constructor() {
			super();
			//only a closed root is worth reaching through internals, and reading them attaches them
			const existingRoot =
				mergedOptions.mode === "closed"
					? resolveShadowRoot(this)
					: this.shadowRoot;
			this.#isHydrationPending = existingRoot !== null;
			this.#shadowRoot = existingRoot ?? this.attachShadow(mergedOptions);
		}

		connectedCallback() {
			if (this.#instance) refreshStyleSheetsAfterMove(this.#instance);
			//an insertion is the only notice of a move, and a move can put a different component above
			//this one
			forgetWhereThisRunSits(this.#renderRun);
			try {
				recoverPreUpgradeAssignments(this, props);
			} catch (error) {
				return endRunWithFatalError(this.#renderRun, error);
			}
			requestRender(this.#renderRun, RENDER_REQUEST.START);
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (this.isConnected) return;
			requestRender(this.#renderRun, RENDER_REQUEST.STOP);
		}

		attributeChangedCallback(
			attributeName: string,
			oldValue: string | null,
			newValue: string | null,
		) {
			if (this.#isReflecting) return;
			if (oldValue === newValue) return;
			if (attributeName === DEFER_HYDRATION_ATTRIBUTE) {
				//upgrade replays a present attribute as null → "", which is the mark arriving; only its
				//removal is the parent releasing this child
				const parentHasSuppliedItsValues = newValue === null;
				if (parentHasSuppliedItsValues)
					requestRender(this.#renderRun, RENDER_REQUEST.START);
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
			return requestRender(this.#renderRun, RENDER_REQUEST.RERENDER);
		}

		#displayFatalError(error: unknown): void {
			this.#revertAllHostBindings();
			this.#instance = null;
			this.#shadowRoot.replaceChildren();
			const isHandledByTheApp = !this.dispatchEvent(
				new ComponentErrorEvent(error, this.localName),
			);
			if (isHandledByTheApp) return;
			console.error(`grundlage: <${this.localName}> stopped rendering.`, error);
			this.#shadowRoot.textContent = `${error}`;
		}

		#paint(value: unknown): void {
			const templateValue = coerceToTemplate(value);

			if (this.#isHydrationPending) {
				//cleared before the attempt, not after: a throw an outer generator catches paints again, and
				//a second pass through here would hydrate the recovery content against the server's tree
				this.#isHydrationPending = false;
				//before the attempt: a rejected range rebuilds the whole root, and that rebuild removes
				//the very payload scripts this reads
				warnOnUnclaimedSsrPayloads(this.#shadowRoot);
				if (!this.#hydrateRoot(templateValue)) {
					warnOnRejectedServerRange();
					this.#paintRoot(templateValue);
				}
				releaseDeferredChildren(this.#shadowRoot);
			} else {
				this.#paintRoot(templateValue);
			}
			//latched rather than a fresh isServer(): the global is mutable and the paint must agree
			//with the driver that scheduled it
			if (this.#renderRun.wasMountedOnTheServer) flushHostPayload(this);
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

		//a host binding is output on every render and not only the first, so the flag covers the
		//patch as well. Only the host bindings: a child mounted or written further down is free to
		//ask this component to render again, which is what the flag would swallow
		#patchHostBindings(instance: Instance, values: Array<unknown>): void {
			this.#isWritingHostBindings = true;
			try {
				commitHostBindings(instance, values);
			} finally {
				this.#isWritingHostBindings = false;
			}
		}

		#paintRoot(value: TemplateValue): void {
			const current = this.#instance;
			const parsed = getParsedTemplate(value.__templateStrings);
			if (isPatchableInPlace(current, parsed)) {
				this.#patchHostBindings(current, value.values);
				patchInstance(current, value.values);
				return;
			}
			const { instance, fragment } = mountInstance(
				value,
				parsed,
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
				getParsedTemplate(value.__templateStrings),
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
				revertHostBinding(liveBindings[index] as AttributeLaneLiveBinding);
		}
	}

	return BaseElement as ComponentConstructor<DeclaredSchema>;
};
