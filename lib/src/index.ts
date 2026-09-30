import { getFormAssociatedBaseClass } from "./forms";
import {
	applyAttributeValue,
	isDeclaredPropName,
} from "./rendering/bindings/attribute-write";
import {
	ComponentRoot,
	createComponentRoot,
	renderedInstanceOf,
} from "./rendering/component-root";
import {
	alreadySettled,
	createRenderRun,
	endRunWithFatalError,
	RENDER_REQUEST,
	RenderRun,
	requestRender,
} from "./runtime/driver";
import { forgetWhereThisRunSits } from "./runtime/render-order";
import { html as htmlValue } from "./template";
import { refreshStyleSheetsAfterMove } from "./rendering/instance";
import { DEFER_HYDRATION_ATTRIBUTE } from "./rendering/constants";
import { resolveShadowRoot } from "./rendering/dom";
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
	claimPropValueChange,
} from "./props/values";
import { isGeneratorFunction } from "./runtime/task";
import { InvariantError, libraryMessage } from "./utils/diagnostics";

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
			libraryMessage(
				"component(fn) expects a generator function. Add the * after function.",
			),
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

		#root: ComponentRoot;
		#internals: ElementInternals | null = null;
		#props: PropValues = createComponentProps(props, this);
		#isReflecting = false;
		#renderRun: RenderRun;

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
						if (!this.#claimPropChange(prop, incoming)) return;
						this.#reflect(attributeName, prop);
						this.update();
					},
				});
		}

		//the resolver is user code, and neither the parent's paint nor attributeChangedCallback may
		//receive its throw
		#claimPropChange(prop: Prop, incoming: unknown): boolean {
			try {
				return claimPropValueChange(this.#props, prop, incoming);
			} catch (error) {
				if (error instanceof InvariantError) throw error;
				endRunWithFatalError(this.#renderRun, error);
				return false;
			}
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
			this.#root = createComponentRoot(
				this,
				existingRoot ?? this.attachShadow(mergedOptions),
				existingRoot !== null,
			);
			this.#renderRun = createRenderRun({
				root: this.#root,
				componentProps: this.#props as unknown as ComponentProps,
				componentGenerator: componentGenerator as ComponentGenerator,
			});
		}

		connectedCallback() {
			const instance = renderedInstanceOf(this.#root);
			if (instance !== null) refreshStyleSheetsAfterMove(instance);
			//an insertion is the only notice of a move, and a move can put a different component above
			//this one
			forgetWhereThisRunSits(this.#renderRun);
			try {
				recoverPreUpgradeAssignments(this, props);
			} catch (error) {
				if (error instanceof InvariantError) throw error;
				endRunWithFatalError(this.#renderRun, error);
				return;
			}
			requestRender(this.#renderRun, RENDER_REQUEST.START);
		}

		async disconnectedCallback() {
			requestRender(this.#renderRun, RENDER_REQUEST.DISCONNECT);
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
			if (this.#claimPropChange(prop, newValue)) this.update();
		}

		setProp(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeValue(this, name, value, oldValue);
			const nothingElseWillScheduleThisWrite = !isDeclaredPropName(this, name);
			if (nothingElseWillScheduleThisWrite) this.update();
		}

		update(): Promise<void> {
			//four paths reach here from inside a host-binding write; this is the one funnel
			if (this.#root.isWritingHostBindings) return alreadySettled;
			return requestRender(this.#renderRun, RENDER_REQUEST.RERENDER);
		}
	}

	return BaseElement as ComponentConstructor<DeclaredSchema>;
};
