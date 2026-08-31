import { BINDING } from "../parser/constants";
import { getParsedTemplate } from "../parser/html";
import { ParsedTemplate } from "../parser/types";
import { TemplateValue } from "../template";
import {
	commitLiveBinding,
	createLiveBinding,
	hydrateLiveBinding,
} from "./bindings/dispatch";
import { commitContent, hydrateContent } from "./bindings/content";
import { rebindStyleSheet } from "./bindings/css-apply";
import {
	BranchContentState,
	StyleSheetMoveState,
	ContentLiveBinding,
	ListContentState,
	LiveBinding,
	RawContentLiveBinding,
} from "./bindings/types";
import { CONTENT_KIND } from "./constants";
import { buildFragment } from "./dom";
import { nextOpenMarker, scanToClose } from "./markers";

export interface Instance {
	parsed: ParsedTemplate;
	liveBindings: Array<LiveBinding>;
	moveState: StyleSheetMoveState;
}

export const patchInstance = (
	instance: Instance,
	values: Array<unknown>,
): void => {
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++)
		commitLiveBinding(instance, liveBindings[index], values);
};

//a DOM move reparses every <style> in the moved subtree from its stale text; each nested
//component refreshes its own shadow tree from its connectedCallback, so this walk stays
//within one instance tree
export const refreshStyleSheetsAfterMove = (instance: Instance): void => {
	if (!instance.moveState.needsStyleSheetRefreshOnMove) return;
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++) {
		const liveBinding = liveBindings[index];
		if (liveBinding.staticBinding.type === BINDING.RAW_CONTENT) {
			rebindStyleSheet(liveBinding as RawContentLiveBinding);
			continue;
		}
		if (liveBinding.staticBinding.type !== BINDING.CONTENT) continue;
		const content = (liveBinding as ContentLiveBinding).content;
		if (content.kind === CONTENT_KIND.BRANCH) {
			const branch = (content as BranchContentState).instance;
			if (branch) refreshStyleSheetsAfterMove(branch);
			continue;
		}
		if (content.kind !== CONTENT_KIND.LIST) continue;
		const { items } = content as ListContentState;
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++)
			refreshStyleSheetsAfterMove(items[itemIndex].instance);
	}
};

export const isPatchableInPlace = (
	current: Instance | null,
	parsed: ParsedTemplate,
): current is Instance =>
	current !== null && current.parsed.templateHash === parsed.templateHash;

export const resolveNestedTemplate = (value: TemplateValue): ParsedTemplate => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (parsed.hostBindingCount > 0)
		throw new Error(
			"grundlage: `<template>` with attributes is only valid at the top level of a component's render " +
				"output — not inside ${...} content, a list item, or any nested template position.",
		);
	return parsed;
};

const createInstance = (
	parsed: ParsedTemplate,
	moveState: StyleSheetMoveState,
): Instance => {
	moveState.needsStyleSheetRefreshOnMove ||= parsed.hasStyleSheetBinding;
	return {
		parsed,
		liveBindings: new Array(parsed.bindings.length),
		moveState,
	};
};

//false means a binding found no marker, which only a server range can do: a fresh clone carries
//every marker the parse counted
const bindMarkedRange = (
	walker: TreeWalker,
	instance: Instance,
	values: Array<unknown>,
	rangeEnd: Comment | null,
	applyToBinding: typeof commitLiveBinding | typeof hydrateLiveBinding,
	applyContent: typeof commitContent | typeof hydrateContent,
): boolean => {
	const { bindings, hostBindingCount } = instance.parsed;
	const { liveBindings } = instance;

	for (let bindingIndex = hostBindingCount; bindingIndex < bindings.length;) {
		const openMarker = nextOpenMarker(walker, rangeEnd);
		if (openMarker === null) return false;
		const staticBinding = bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const liveBinding = createLiveBinding(staticBinding, openMarker);
			applyToBinding(instance, liveBinding, values);
			liveBindings[bindingIndex++] = liveBinding;
			continue;
		}

		const closeMarker = scanToClose(
			walker,
			openMarker,
			staticBinding.closeMarkerData,
			rangeEnd,
		);
		if (closeMarker === null) return false;
		const liveBinding = createLiveBinding(
			staticBinding,
			openMarker,
			closeMarker,
		) as ContentLiveBinding;
		//the scan left the walker on the close marker, so a nested hydration would start past its
		//own range; this puts it back inside, and the line after the call undoes the descent
		walker.currentNode = openMarker;
		applyContent(liveBinding, values, instance.moveState, walker);
		liveBindings[bindingIndex++] = liveBinding;
		walker.currentNode = closeMarker;
	}

	return true;
};

export const mountInstance = (
	value: TemplateValue,
	parsed: ParsedTemplate,
	moveState: StyleSheetMoveState,
): { instance: Instance; fragment: DocumentFragment } => {
	parsed.fragmentCloneSource ??= buildFragment(parsed.htmlWithMarkers);
	const fragment = parsed.fragmentCloneSource.cloneNode(
		true,
	) as DocumentFragment;
	const instance = createInstance(parsed, moveState);

	bindMarkedRange(
		document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT),
		instance,
		value.values,
		null,
		commitLiveBinding,
		commitContent,
	);

	return { instance, fragment };
};

export const hydrateInstance = (
	walker: TreeWalker,
	value: TemplateValue,
	parsed: ParsedTemplate,
	rangeEnd: Comment | null,
	moveState: StyleSheetMoveState,
): Instance | null => {
	const instance = createInstance(parsed, moveState);
	return bindMarkedRange(
		walker,
		instance,
		value.values,
		rangeEnd,
		hydrateLiveBinding,
		hydrateContent,
	)
		? instance
		: null;
};
