import { BINDING } from "../parser/constants";
import { getParsedTemplate } from "../parser/html";
import { ParsedTemplate } from "../parser/types";
import { TemplateValue } from "../template";
import {
	commitLiveBinding,
	createLiveBinding,
	hydrateLiveBinding,
} from "./bindings/dispatch";
import { rebindStyleSheet } from "./bindings/css-apply";
import {
	BranchContentState,
	StyleSheetMoveState,
	ContentLiveBinding,
	ContentState,
	ListContentState,
	LiveBinding,
	RawContentLiveBinding,
} from "./bindings/types";
import { CONTENT_KIND } from "./constants";
import { buildFragment } from "./dom";
import {
	isOpenMarker,
	nextListTail,
	nextOpenMarker,
	scanToClose,
} from "./markers";

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

export const releaseInstance = (instance: Instance): void => {
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++) {
		const liveBinding = liveBindings[index];
		if (liveBinding.staticBinding.type === BINDING.CONTENT)
			releaseContent((liveBinding as ContentLiveBinding).content);
	}
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
			rebindStyleSheet(
				liveBinding as RawContentLiveBinding,
				instance.moveState,
			);
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

export const releaseContent = (content: ContentState): void => {
	if (content.kind === CONTENT_KIND.BRANCH) {
		const { instance } = content as BranchContentState;
		if (instance) releaseInstance(instance);
		return;
	}
	if (content.kind !== CONTENT_KIND.LIST) return;
	const { items } = content as ListContentState;
	for (let index = 0; index < items.length; index++)
		releaseInstance(items[index].instance);
};

export const reconcileInstance = (
	current: Instance | null,
	value: TemplateValue,
	moveState: StyleSheetMoveState,
): { instance: Instance; fragment: DocumentFragment } | null => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (current && current.parsed.templateHash === parsed.templateHash) {
		patchInstance(current, value.values);
		return null;
	}
	return mountInstance(value, moveState);
};

export const assertNestable = (value: TemplateValue): void => {
	if (getParsedTemplate(value.__templateStrings).hostBindingCount > 0)
		throw new Error(
			"grundlage: `<template>` with attributes is only valid at the top level of a component's render " +
				"output — not inside ${...} content, a list item, or any nested template position.",
		);
};

export const mountInstance = (
	value: TemplateValue,
	moveState: StyleSheetMoveState,
): { instance: Instance; fragment: DocumentFragment } => {
	const parsed = getParsedTemplate(value.__templateStrings);
	parsed.fragmentCloneSource ??= buildFragment(parsed.htmlWithMarkers);
	const fragment = parsed.fragmentCloneSource.cloneNode(
		true,
	) as DocumentFragment;

	const { bindings, hostBindingCount } = parsed;
	moveState.needsStyleSheetRefreshOnMove ||= parsed.hasStyleSheetBinding;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);
	const instance: Instance = { parsed, liveBindings, moveState };
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	let bindingIndex = hostBindingCount;

	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (!isOpenMarker(node.data)) continue;
		const staticBinding = bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const live = createLiveBinding(staticBinding, node);
			commitLiveBinding(instance, live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = node.nextSibling as Comment;
		const live = createLiveBinding(staticBinding, node, closeMarker);
		commitLiveBinding(instance, live, value.values);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return { instance, fragment };
};

const hydrateInstanceWithWalker = (
	walker: TreeWalker,
	value: TemplateValue,
	moveState: StyleSheetMoveState,
): Instance => {
	const parsed = getParsedTemplate(value.__templateStrings);
	const { bindings, hostBindingCount } = parsed;
	moveState.needsStyleSheetRefreshOnMove ||= parsed.hasStyleSheetBinding;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);
	const instance: Instance = { parsed, liveBindings, moveState };

	for (let bindingIndex = hostBindingCount; bindingIndex < bindings.length;) {
		const open = nextOpenMarker(walker);
		const staticBinding = bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const live = createLiveBinding(staticBinding, open);
			hydrateLiveBinding(instance, live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = scanToClose(walker, open);
		const live = createLiveBinding(staticBinding, open, closeMarker);
		hydrateLiveBinding(instance, live, value.values);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return instance;
};

const createCommentWalkerAt = (startNode: Node): TreeWalker => {
	const walker = document.createTreeWalker(
		startNode.getRootNode(),
		NodeFilter.SHOW_COMMENT,
	);
	walker.currentNode = startNode;
	return walker;
};

export const hydrateInstance = (
	value: TemplateValue,
	startNode: Node,
	moveState: StyleSheetMoveState,
): Instance =>
	hydrateInstanceWithWalker(createCommentWalkerAt(startNode), value, moveState);

export const hydrateRow = (
	value: TemplateValue,
	rowStart: Node,
	moveState: StyleSheetMoveState,
): { instance: Instance; tailMarker: Comment } => {
	const walker = createCommentWalkerAt(rowStart);
	const instance = hydrateInstanceWithWalker(walker, value, moveState);
	return { instance, tailMarker: nextListTail(walker) };
};
