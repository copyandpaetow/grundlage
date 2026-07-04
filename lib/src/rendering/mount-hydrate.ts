import { BINDING } from "../parser/types";
import { getParsedTemplate } from "../parser/html";
import { COMMENT_IDENTIFIER } from "../parser/html-util";
import { TemplateValue } from "../template-value";
import { hashValue } from "../utils/hashing";
import { buildFragment } from "./build-fragment";
import {
	commitLiveBinding,
	computeGateHash,
	contentKindOf,
	createLiveBinding,
	freshContentState,
	seedOrCommitSingleValue,
} from "./commit";
import { CONTENT_KIND } from "./constants";
import { normalizeToAttributeMap } from "./dynamic-attribute";
import {
	BranchContentState,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	Instance,
	LiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
	TextContentState,
} from "./instance";
import { hydrateListItems } from "./list";

const isRangeType = (type: number): boolean =>
	type === BINDING.CONTENT || type === BINDING.COMMENT;

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

const linkTagSiblings = (liveBindings: Array<LiveBinding>): void => {
	for (let index = 0; index < liveBindings.length; index++) {
		const liveBinding = liveBindings[index];
		if (liveBinding === undefined || liveBinding.staticBinding.type !== BINDING.TAG)
			continue;
		const tag = liveBinding as TagLiveBinding;
		const related = tag.staticBinding.relatedBindingIndices;
		tag.relatedLiveBindings = new Array(related.length);
		for (let r = 0; r < related.length; r++)
			tag.relatedLiveBindings[r] = liveBindings[related[r]];
	}
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
			commitLiveBinding(live, value.values);
			liveBindings[bindingIndex++] = live;
			continue;
		}

		const closeMarker = node.nextSibling as Comment;
		const live = createLiveBinding(staticBinding, node, null, closeMarker);
		commitLiveBinding(live, value.values);
		liveBindings[bindingIndex++] = live;
		walker.currentNode = closeMarker;
	}

	linkTagSiblings(liveBindings);
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

	linkTagSiblings(liveBindings);
	return { templateHash: parsed.templateHash, liveBindings };
};

export const seedLiveBinding = (
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.EVENT:
			return commitLiveBinding(liveBinding, values);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return seedOrCommitSingleValue(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE: {
			const dynamic = liveBinding as DynamicAttributeLiveBinding;
			const value = values[dynamic.staticBinding.valueIndex];
			dynamic.lastValueHash = hashValue(value);
			dynamic.appliedAttributes = normalizeToAttributeMap(value);
			return;
		}
		case BINDING.CONTENT:
			return seedContentByAdoption(liveBinding as ContentLiveBinding, values);
		default:
			(liveBinding as { valueHash: number }).valueHash = computeGateHash(
				liveBinding,
				values,
			);
	}
};

const seedContentByAdoption = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const kind = contentKindOf(value);
	liveBinding.content = freshContentState(kind);
	switch (kind) {
		case CONTENT_KIND.TEXT:
			(liveBinding.content as TextContentState).lastValueHash = hashValue(value);
			return;
		case CONTENT_KIND.BRANCH:
			assertNestable(value as TemplateValue);
			(liveBinding.content as BranchContentState).instance = hydrateInstance(
				value as TemplateValue,
				liveBinding.startMarker,
				liveBinding.endMarker,
			);
			return;
		case CONTENT_KIND.LIST:
			return hydrateListItems(liveBinding, value as Array<unknown>);
	}
};
