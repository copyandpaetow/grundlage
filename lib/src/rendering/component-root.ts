import {
	commitLiveBinding,
	createAttributeLaneLiveBinding,
	revertHostBinding,
} from "./bindings/live-binding";
import {
	AttributeLaneLiveBinding,
	Instance,
	StyleSheetMoveState,
} from "./bindings/types";
import { getParsedTemplate } from "../parser/html";
import {
	AttributeStaticBinding,
	DynamicAttributeStaticBinding,
} from "../parser/types";
import { warnOnUnclaimedSSRPayloads } from "../load";
import { TemplateValue } from "../template";
import { ComponentErrorEvent } from "../runtime/component-error-event";
import {
	HYDRATION_MISMATCH,
	commitHostBindings,
	hydrateInstance,
	isPatchableInPlace,
	cloneTemplateFragment,
	mountInstance,
	patchInstance,
} from "./instance";
import { releaseDeferredChildren } from "./defer-hydration";
import { warnOnRejectedServerRange } from "./markers";
import { BaseComponent } from "../types";
import { libraryMessage } from "../utils/diagnostics";

export interface ComponentRoot {
	host: BaseComponent;
	//held rather than read from the host: for mode "closed" host.shadowRoot is null
	shadowRoot: ShadowRoot;
	styleSheetMoveState: StyleSheetMoveState;
	instance: Instance | typeof HYDRATION_PENDING | null;
}

const HYDRATION_PENDING: unique symbol = Symbol("hydration pending");

export const paintedInstanceOf = (root: ComponentRoot): Instance | null =>
	root.instance === HYDRATION_PENDING ? null : root.instance;

export const createComponentRoot = (
	host: BaseComponent,
	shadowRoot: ShadowRoot,
	isHydrationPending: boolean,
): ComponentRoot => ({
	host,
	shadowRoot,
	styleSheetMoveState: { needsStyleSheetRefreshOnMove: false },
	instance: isHydrationPending ? HYDRATION_PENDING : null,
});

const revertAllHostBindings = (root: ComponentRoot): void => {
	const instance = paintedInstanceOf(root);
	if (instance === null) return;
	const liveBindings = instance.liveBindings;
	for (let index = 0; index < instance.parsed.hostBindingCount; index++)
		revertHostBinding(liveBindings[index] as AttributeLaneLiveBinding);
};

//the revert reads root.instance, which is still the outgoing one here and null on a first paint
const mountHostBindings = (
	root: ComponentRoot,
	instance: Instance,
	values: Array<unknown>,
): void => {
	revertAllHostBindings(root);
	const { bindings, hostBindingCount } = instance.parsed;
	for (let index = 0; index < hostBindingCount; index++) {
		const live = createAttributeLaneLiveBinding(
			//the parser places only attribute bindings before hostBindingCount
			bindings[index] as AttributeStaticBinding | DynamicAttributeStaticBinding,
			root.host,
		);
		commitLiveBinding(instance, live, values);
		instance.liveBindings[index] = live;
	}
};

const mountOrPatchRoot = (
	root: ComponentRoot,
	current: Instance | null,
	value: TemplateValue,
): Instance => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (isPatchableInPlace(current, parsed)) {
		commitHostBindings(current, value.values);
		patchInstance(current, value.values);
		return current;
	}
	const fragment = cloneTemplateFragment(parsed, root.shadowRoot);
	const instance = mountInstance(
		fragment,
		value,
		parsed,
		root.styleSheetMoveState,
	);
	mountHostBindings(root, instance, value.values);
	root.shadowRoot.replaceChildren(fragment);
	return instance;
};

export const paintComponentRoot = (
	root: ComponentRoot,
	templateValue: TemplateValue,
): void => {
	const current = root.instance;
	if (current === HYDRATION_PENDING) {
		//cleared before the attempt, not after: a throw an outer generator catches paints again, and
		//a second pass through here would hydrate the recovery content against the server's tree
		root.instance = null;
		//before the attempt: a rejected range rebuilds the whole root, and that rebuild removes
		//the very payload scripts this reads
		warnOnUnclaimedSSRPayloads(root.shadowRoot);
		const hydrated = hydrateInstance(
			document.createTreeWalker(root.shadowRoot, NodeFilter.SHOW_COMMENT),
			templateValue,
			getParsedTemplate(templateValue.__templateStrings),
			null,
			root.styleSheetMoveState,
		);
		if (hydrated === HYDRATION_MISMATCH) {
			warnOnRejectedServerRange();
			root.instance = mountOrPatchRoot(root, null, templateValue);
		} else {
			mountHostBindings(root, hydrated, templateValue.values);
			root.instance = hydrated;
		}
		releaseDeferredChildren(root.shadowRoot);
	} else root.instance = mountOrPatchRoot(root, current, templateValue);
};

export const displayFatalErrorInRoot = (
	root: ComponentRoot,
	error: unknown,
): void => {
	revertAllHostBindings(root);
	root.instance = null;
	root.shadowRoot.replaceChildren();
	const { host } = root;
	const isHandledByApp = !host.dispatchEvent(
		new ComponentErrorEvent(error, host.localName),
	);
	if (isHandledByApp) return;
	console.error(libraryMessage(`<${host.localName}> stopped running.`), error);
	root.shadowRoot.textContent = `${error}`;
};
