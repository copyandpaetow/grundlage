import { BINDING, COMMENT_IDENTIFIER } from "../parser/constants";
import { getParsedTemplate } from "../parser/html";
import { TemplateValue } from "../template";
import {
	commitLiveBinding,
	createLiveBinding,
	seedLiveBinding,
} from "./bindings/dispatch";
import { LiveBinding } from "./bindings/types";
import { buildFragment } from "./dom";

export interface Instance {
	templateHash: number;
	liveBindings: Array<LiveBinding>;
}

export const patchInstance = (
	instance: Instance,
	values: Array<unknown>,
): void => {
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++)
		commitLiveBinding(liveBindings[index], values, liveBindings);
};

export const reconcileInstance = (
	current: Instance | null,
	value: TemplateValue,
): { instance: Instance; fragment: DocumentFragment } | null => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (current !== null && current.templateHash === parsed.templateHash) {
		patchInstance(current, value.values);
		return null;
	}
	return mountInstance(value);
};

const isRangeType = (type: number): boolean => type === BINDING.CONTENT;

const isOpenMarker = (data: string): boolean =>
	data.startsWith(COMMENT_IDENTIFIER + " ") &&
	data[COMMENT_IDENTIFIER.length + 1] !== "/";

const closeOf = (openData: string): string =>
	openData.replace(COMMENT_IDENTIFIER + " ", COMMENT_IDENTIFIER + " /");

export const assertNestable = (value: TemplateValue): void => {
	if (getParsedTemplate(value.__templateStrings).hostBindingCount > 0)
		throw new Error(
			"`<template>` with attributes is only valid at the top level of a component's render " +
				"output — not inside ${...} content, a list item, or any nested template position.",
		);
};

export const mountInstance = (
	value: TemplateValue,
): { instance: Instance; fragment: DocumentFragment } => {
	const parsed = getParsedTemplate(value.__templateStrings);
	parsed.fragmentCloneSource ??= buildFragment(parsed.htmlWithMarkers);
	const fragment = parsed.fragmentCloneSource.cloneNode(true) as DocumentFragment;

	const { bindings, hostBindingCount } = parsed;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
	let bindingIndex = hostBindingCount;

	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (!isOpenMarker(node.data)) continue;
		const staticBinding = bindings[bindingIndex];

		if (!isRangeType(staticBinding.type)) {
			const live = createLiveBinding(staticBinding, node, null);
			commitLiveBinding(live, value.values, liveBindings);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = node.nextSibling as Comment;
		const live = createLiveBinding(staticBinding, node, null, closeMarker);
		commitLiveBinding(live, value.values, liveBindings);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return {
		instance: { templateHash: parsed.templateHash, liveBindings },
		fragment,
	};
};

const rootOf = (node: Node): Node => node.getRootNode();

const scanToClose = (walker: TreeWalker, open: Comment): Comment => {
	const openData = open.data;
	const closeData = closeOf(openData);
	let depth = 1;
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node.data === openData) depth++;
		else if (node.data === closeData && --depth === 0) return node;
	}
	throw new Error("unterminated content marker");
};

const nextOpenMarker = (
	walker: TreeWalker,
	rangeEnd: Comment | null,
): Comment | null => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (isOpenMarker(node.data)) return node;
	}
	return null;
};

export const hydrateInstance = (
	value: TemplateValue,
	rangeStart: Node,
	rangeEnd: Comment | null = null,
): Instance => {
	const parsed = getParsedTemplate(value.__templateStrings);
	const { bindings, hostBindingCount } = parsed;
	const liveBindings: Array<LiveBinding> = new Array(bindings.length);

	const walker = document.createTreeWalker(
		rootOf(rangeStart),
		NodeFilter.SHOW_COMMENT,
	);
	walker.currentNode = rangeStart;
	let bindingIndex = hostBindingCount;

	let open: Comment | null;
	while ((open = nextOpenMarker(walker, rangeEnd))) {
		const staticBinding = bindings[bindingIndex];

		if (!isRangeType(staticBinding.type)) {
			const live = createLiveBinding(staticBinding, open, null);
			seedLiveBinding(live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = scanToClose(walker, open);
		const live = createLiveBinding(staticBinding, open, null, closeMarker);
		seedLiveBinding(live, value.values);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	return { templateHash: parsed.templateHash, liveBindings };
};
