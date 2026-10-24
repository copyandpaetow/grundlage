import { getFormAssociatedBaseClass } from "./forms";
import {
	applyAttributeValue,
	isDeclaredPropName,
} from "./rendering/bindings/attribute-apply";
import { ComponentRoot, createComponentRoot } from "./rendering/component-root";
import {
	ComponentRunner,
	createComponentRunner,
	endRunnerWithFatalError,
	sendRunnerRequest,
} from "./runtime/driver";
import * as RUNNER_REQUEST from "./runtime/runner-request";
import { forgetAncestorRunner } from "./runtime/update-order";
import { html as htmlValue } from "./template";
import { refreshStyleSheetsAfterMove } from "./rendering/instance";
import {
	DECLARED_PROP_NAMES,
	DEFER_HYDRATION_ATTRIBUTE,
	PROPERTY_PROP_NAMES,
} from "./rendering/constants";
import { findShadowRoot } from "./rendering/dom";
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
	ensurePropNamesAreAvailable,
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
import { isAsyncGeneratorFunction, isGeneratorFunction } from "./runtime/run";
import * as PROP_KIND from "./props/prop-kind";
import {
	InvariantError,
	isDevelopmentBuild,
	libraryMessage,
	warnDuringDevelopment,
} from "./utils/diagnostics";
import { isServer } from "./utils/guards";

export {
	type BaseComponent,
	type Cleanup,
	type ComponentOptions,
	type ComponentProps,
	type PassedPropsOf,
	type PropsOf,
	type Resolve,
	type Schema,
	type Template,
	type UpdateGenerator,
	type YieldableValue,
} from "./types";
export { awaited } from "./awaited";
export * as prop from "./prop";
export { load } from "./load";
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
	if (isAsyncGeneratorFunction(componentGenerator))
		throw new TypeError(
			libraryMessage(
				"component(fn) expects a generator function, not an async one. Drop the async and yield each promise instead of awaiting it.",
			),
		);
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
	const requiredPropNames = [...props.values()]
		.filter((prop) => prop.isRequired)
		.map((prop) => prop.propName);

	class BaseElement extends ParentClass implements BaseComponent {
		static observedAttributes = [
			...[...props]
				.filter(([, prop]) => prop.kind !== PROP_KIND.PROPERTY)
				.map(([attributeName]) => attributeName),
			DEFER_HYDRATION_ATTRIBUTE,
		];
		static readonly [DECLARED_PROP_NAMES]: ReadonlySet<string> = new Set(
			[...props.values()].map((prop) => prop.propName),
		);
		static readonly [PROPERTY_PROP_NAMES]: ReadonlySet<string> = new Set(
			[...props.values()]
				.filter((prop) => prop.kind === PROP_KIND.PROPERTY)
				.map((prop) => prop.propName),
		);

		#root: ComponentRoot;
		#internals: ElementInternals | null = null;
		#props: PropValues = createComponentProps(props, this);
		#isReflecting = false;
		#runner: ComponentRunner;
		#startAfterThisTask = (): void => {
			sendRunnerRequest(this.#runner, RUNNER_REQUEST.START);
		};

		get internals(): ElementInternals | null {
			return (this.#internals ??= this.attachInternals?.() ?? null);
		}

		static {
			ensurePropNamesAreAvailable(this.prototype, props);
			for (const [attributeName, prop] of props)
				Object.defineProperty(this.prototype, prop.propName, {
					enumerable: true,
					configurable: true,
					get(this: BaseElement) {
						return this.#props[prop.propName];
					},
					set(this: BaseElement, incoming: unknown) {
						if (!this.#claimPropChange(prop, incoming)) return;
						if (prop.kind === PROP_KIND.ATTRIBUTE)
							this.#reflect(attributeName, prop);
						this.#scheduleAfterPropChange();
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
				endRunnerWithFatalError(this.#runner, error);
				return false;
			}
		}

		//the write that completes the required props queues the start, so every write of the same task
		//lands before the body reads them; START is a no-op unless the runner waits to start
		#scheduleAfterPropChange(): void {
			this.update();
			if (requiredPropNames.length > 0)
				queueMicrotask(this.#startAfterThisTask);
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
					? findShadowRoot(this)
					: this.shadowRoot;
			this.#root = createComponentRoot(
				this,
				existingRoot ?? this.attachShadow(mergedOptions),
				existingRoot !== null,
			);
			this.#runner = createComponentRunner({
				requiredPropNames,
				root: this.#root,
				componentProps: this.#props as unknown as ComponentProps,
				componentGenerator: componentGenerator as ComponentGenerator,
			});
		}

		connectedCallback() {
			const instance = this.#root.instance;
			if (instance !== null) refreshStyleSheetsAfterMove(instance);
			//an insertion is the only notice of a move, and a move can put a different component above
			//this one
			forgetAncestorRunner(this.#runner);
			try {
				recoverPreUpgradeAssignments(this, props);
			} catch (error) {
				if (error instanceof InvariantError) throw error;
				endRunnerWithFatalError(this.#runner, error);
				return;
			}
			const missingPropName = requiredPropNames.find(
				(propName) => this.#props[propName] === undefined,
			);
			//on the server nothing arrives after connection, so a missing required prop never will
			if (missingPropName !== undefined && isServer()) {
				endRunnerWithFatalError(
					this.#runner,
					new TypeError(
						libraryMessage(
							`prop "${missingPropName}" is required, and nothing supplied it before the server rendered <${this.localName}>. Give it a fallback, or render the element inside a component that binds it.`,
						),
					),
				);
				return;
			}
			if (missingPropName !== undefined && isDevelopmentBuild)
				requestAnimationFrame(() => this.#warnIfStillMissing(missingPropName));
			sendRunnerRequest(this.#runner, RUNNER_REQUEST.START);
		}

		#warnIfStillMissing(propName: string): void {
			if (!this.isConnected || this.#props[propName] !== undefined) return;
			warnDuringDevelopment(
				`<${this.localName}> waits for its required prop "${propName}", which is still missing a frame after it connected. Bind it from the parent, assign it, or give it a fallback.`,
			);
		}

		async disconnectedCallback() {
			sendRunnerRequest(this.#runner, RUNNER_REQUEST.DISCONNECT);
			await Promise.resolve();
			if (this.isConnected) return;
			sendRunnerRequest(this.#runner, RUNNER_REQUEST.STOP);
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
				const parentHasSuppliedValues = newValue === null;
				if (parentHasSuppliedValues)
					sendRunnerRequest(this.#runner, RUNNER_REQUEST.START);
				return;
			}
			const prop = props.get(attributeName);
			if (prop === undefined) return;
			if (this.#claimPropChange(prop, newValue))
				this.#scheduleAfterPropChange();
		}

		setProp(name: string, value: unknown, oldValue?: unknown) {
			applyAttributeValue(this, name, value, oldValue);
			const nothingElseWillScheduleWrite = !isDeclaredPropName(this, name);
			if (nothingElseWillScheduleWrite) this.update();
		}

		update(): Promise<void> {
			return sendRunnerRequest(this.#runner, RUNNER_REQUEST.UPDATE);
		}
	}

	return BaseElement as ComponentConstructor<DeclaredSchema>;
};
