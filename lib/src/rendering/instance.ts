import { BINDING } from "../parser/constants";
import { getParsedTemplate } from "../parser/html";
import { TemplateValue } from "../template";
import { releaseCssGroups } from "./bindings/css-apply";
import {
	commitLiveBinding,
	createLiveBinding,
	seedLiveBinding,
} from "./bindings/dispatch";
import {
	BranchContentState,
	Carrier,
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
} from "./range";

export interface Instance {
	templateHash: number;
	liveBindings: Array<LiveBinding>;
}

export const patchInstance = (
	instance: Instance,
	values: Array<unknown>,
): void => {
	// Commit in parser marker order: an element's TAG binding precedes its attribute/event
	// bindings, so a tag swap runs before siblings re-read the new element via targetElement.
	// Reordering this loop (or the marker emission) breaks tag swaps silently.
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++)
		commitLiveBinding(liveBindings[index], values, liveBindings);
};

export const releaseInstance = (instance: Instance): void => {
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++) {
		const liveBinding = liveBindings[index];
		const { type } = liveBinding.staticBinding;
		if (type === BINDING.RAW_CONTENT) {
			const rawContent = liveBinding as RawContentLiveBinding;
			if (rawContent.previousGroupHashes !== null)
				releaseCssGroups(rawContent);
			continue;
		}
		if (type === BINDING.CONTENT)
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
	if (current !== null && current.templateHash === parsed.templateHash) {
		patchInstance(current, value.values);
		return null;
	}
	return mountInstance(value, carrier);
};

const isRangeType = (type: number): boolean => type === BINDING.CONTENT;

export const assertNestable = (value: TemplateValue): void => {
	if (getParsedTemplate(value.__templateStrings).hostBindingCount > 0)
		throw new Error(
			"`<template>` with attributes is only valid at the top level of a component's render " +
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
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	let bindingIndex = hostBindingCount;

	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (!isOpenMarker(node.data)) continue;
		const staticBinding = bindings[bindingIndex];

		if (!isRangeType(staticBinding.type)) {
			const live = createLiveBinding(staticBinding, node, null, null, carrier);
			commitLiveBinding(live, value.values, liveBindings);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = node.nextSibling as Comment;
		const live = createLiveBinding(
			staticBinding,
			node,
			null,
			closeMarker,
			carrier,
		);
		commitLiveBinding(live, value.values, liveBindings);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return {
		instance: { templateHash: parsed.templateHash, liveBindings },
		fragment,
	};
};

const seedInstance = (
	walker: TreeWalker,
	value: TemplateValue,
	carrier: Carrier,
): Instance => {
	const parsed = getParsedTemplate(value.__templateStrings);
	const { bindings, hostBindingCount } = parsed;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);

	for (let bindingIndex = hostBindingCount; bindingIndex < bindings.length; ) {
		const open = nextOpenMarker(walker);
		const staticBinding = bindings[bindingIndex];

		if (!isRangeType(staticBinding.type)) {
			const live = createLiveBinding(staticBinding, open, null, null, carrier);
			seedLiveBinding(live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = scanToClose(walker, open);
		const live = createLiveBinding(
			staticBinding,
			open,
			null,
			closeMarker,
			carrier,
		);
		seedLiveBinding(live, value.values);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return { templateHash: parsed.templateHash, liveBindings };
};

const walkerFrom = (rangeStart: Node): TreeWalker => {
	const walker = document.createTreeWalker(
		rangeStart.getRootNode(),
		NodeFilter.SHOW_COMMENT,
	);
	walker.currentNode = rangeStart;
	return walker;
};

export const hydrateInstance = (
	value: TemplateValue,
	rangeStart: Node,
	carrier: Carrier,
): Instance => seedInstance(walkerFrom(rangeStart), value, carrier);

export const hydrateRow = (
	value: TemplateValue,
	rowStart: Node,
	carrier: Carrier,
): { instance: Instance; tailMarker: Comment } => {
	const walker = walkerFrom(rowStart);
	const instance = seedInstance(walker, value, carrier);
	return { instance, tailMarker: nextListTail(walker) };
};
