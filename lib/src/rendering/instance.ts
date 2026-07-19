import { BINDING } from "../parser/constants";
import { getParsedTemplate } from "../parser/html";
import { ParsedTemplate } from "../parser/types";
import { TemplateValue } from "../template";
import {
	commitLiveBinding,
	createLiveBinding,
	hydrateLiveBinding,
	releaseLiveBinding,
} from "./bindings/dispatch";
import {
	BranchContentState,
	Carrier,
	ContentLiveBinding,
	ContentState,
	ListContentState,
	LiveBinding,
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
	carrier: Carrier;
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
		releaseLiveBinding(liveBinding, instance.carrier.host);
		if (liveBinding.staticBinding.type === BINDING.CONTENT)
			releaseContent((liveBinding as ContentLiveBinding).content);
	}
};

export const releaseContent = (content: ContentState): void => {
	if (content.kind === CONTENT_KIND.BRANCH) {
		const { instance } = content as BranchContentState;
		if (instance !== null) releaseInstance(instance);
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
	carrier: Carrier,
): { instance: Instance; fragment: DocumentFragment } | null => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (current !== null && current.parsed.templateHash === parsed.templateHash) {
		patchInstance(current, value.values);
		return null;
	}
	return mountInstance(value, carrier);
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
	carrier: Carrier,
): { instance: Instance; fragment: DocumentFragment } => {
	const parsed = getParsedTemplate(value.__templateStrings);
	parsed.fragmentCloneSource ??= buildFragment(parsed.htmlWithMarkers);
	const fragment = parsed.fragmentCloneSource.cloneNode(
		true,
	) as DocumentFragment;

	const { bindings, hostBindingCount } = parsed;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);
	const instance: Instance = { parsed, liveBindings, carrier };
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	let bindingIndex = hostBindingCount;

	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (!isOpenMarker(node.data)) continue;
		const staticBinding = bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const live = createLiveBinding(staticBinding, node, null, carrier);
			commitLiveBinding(instance, live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = node.nextSibling as Comment;
		const live = createLiveBinding(staticBinding, node, closeMarker, carrier);
		commitLiveBinding(instance, live, value.values);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return { instance, fragment };
};

const hydrateInstanceWithWalker = (
	walker: TreeWalker,
	value: TemplateValue,
	carrier: Carrier,
): Instance => {
	const parsed = getParsedTemplate(value.__templateStrings);
	const { bindings, hostBindingCount } = parsed;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);
	const instance: Instance = { parsed, liveBindings, carrier };

	for (let bindingIndex = hostBindingCount; bindingIndex < bindings.length; ) {
		const open = nextOpenMarker(walker);
		const staticBinding = bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const live = createLiveBinding(staticBinding, open, null, carrier);
			hydrateLiveBinding(instance, live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = scanToClose(walker, open);
		const live = createLiveBinding(staticBinding, open, closeMarker, carrier);
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
	carrier: Carrier,
): Instance =>
	hydrateInstanceWithWalker(createCommentWalkerAt(startNode), value, carrier);

export const hydrateRow = (
	value: TemplateValue,
	rowStart: Node,
	carrier: Carrier,
): { instance: Instance; tailMarker: Comment } => {
	const walker = createCommentWalkerAt(rowStart);
	const instance = hydrateInstanceWithWalker(walker, value, carrier);
	return { instance, tailMarker: nextListTail(walker) };
};
