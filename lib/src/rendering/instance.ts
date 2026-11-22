//oxlint-disable import/no-cycle -- mutual recursion: a template holds templates
import * as BINDING from "../parser/binding";
import { getParsedTemplate } from "../parser/html";
import { ParsedTemplate } from "../parser/types";
import { TemplateValue } from "../template";
import {
	commitLiveBinding,
	createContentLiveBinding,
	createMarkedLiveBinding,
	hydrateLiveBinding,
} from "./bindings/live-binding";
import { commitContent, hydrateContent } from "./bindings/content";
import { TreeState, Instance } from "./bindings/types";
import { buildFragment } from "./dom";
import { ensureFragmentKeptEveryBinding, nextOpenMarker, scanToClose } from "./markers";
import { parseContextOfChildren, warnWhenParsingWouldSplitParagraph } from "./parse-context";
import { assertDuringDevelopment, libraryMessage } from "../utils/diagnostics";

//liveBindings[0..hostBindingCount) are host bindings, owned by their element: only it knows a
//write to its own declared prop is output, not a reason to update. A nested template has none
export const patchInstance = (instance: Instance, values: Array<unknown>): void => {
	for (
		let index = instance.parsed.hostBindingCount;
		index < instance.liveBindings.length;
		index++
	) {
		commitLiveBinding(instance, instance.liveBindings[index], values);
	}
};

export const commitHostBindings = (instance: Instance, values: Array<unknown>): void => {
	for (let index = 0; index < instance.parsed.hostBindingCount; index++) {
		commitLiveBinding(instance, instance.liveBindings[index], values);
	}
};

export const isPatchableInPlace = (
	current: Instance | null,
	parsed: ParsedTemplate,
): current is Instance => current !== null && current.parsed.templateHash === parsed.templateHash;

export const parseNestedTemplate = (value: TemplateValue): ParsedTemplate => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (parsed.hostBindingCount > 0) {
		throw new Error(
			libraryMessage(
				"`<template>` with attributes is only valid at the top level of the template a component yields, not inside ${...} content, a list item, or any nested template position. Move the attributes to the outermost <template>.",
			),
		);
	}
	return parsed;
};

const createInstance = (parsed: ParsedTemplate, treeState: TreeState): Instance => ({
	parsed,
	liveBindings: new Array(parsed.bindings.length),
	treeState,
});

const bindFreshClone = (walker: TreeWalker, instance: Instance, values: Array<unknown>): void => {
	for (
		let bindingIndex = instance.parsed.hostBindingCount;
		bindingIndex < instance.parsed.bindings.length;
	) {
		const openMarker = nextOpenMarker(walker, null);
		assertDuringDevelopment(
			openMarker !== null,
			"a fresh clone carries every marker the parse counted",
		);
		const staticBinding = instance.parsed.bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const liveBinding = createMarkedLiveBinding(staticBinding, openMarker);
			commitLiveBinding(instance, liveBinding, values);
			instance.liveBindings[bindingIndex++] = liveBinding;
			continue;
		}

		const closeMarker = scanToClose(walker, openMarker, staticBinding.closeMarkerData, null);
		assertDuringDevelopment(
			closeMarker !== null,
			"a fresh clone closes every content range it opens",
		);
		const liveBinding = createContentLiveBinding(staticBinding, openMarker, closeMarker);
		commitContent(liveBinding, values, instance.treeState);
		instance.liveBindings[bindingIndex++] = liveBinding;
	}
};

//lives as long as the parse cache entry: every later mount of the template clones it instead of
//parsing markup again, and the parser cannot build it because it also runs where there is no DOM
const fragmentCloneSourcesByParsedTemplate = new WeakMap<
	ParsedTemplate,
	Array<DocumentFragment | undefined>
>();

export const cloneTemplateFragment = (
	parsed: ParsedTemplate,
	insertionParent: Node | null,
): DocumentFragment => {
	const parseContext = parseContextOfChildren(insertionParent);
	let cloneSources = fragmentCloneSourcesByParsedTemplate.get(parsed);
	if (cloneSources === undefined) {
		cloneSources = [];
		fragmentCloneSourcesByParsedTemplate.set(parsed, cloneSources);
	}
	let cloneSource = cloneSources[parseContext];
	if (cloneSource === undefined) {
		cloneSource = buildFragment(parsed.htmlWithMarkers, parseContext);
		ensureFragmentKeptEveryBinding(cloneSource, parsed);
		for (const element of cloneSource.children) {
			warnWhenParsingWouldSplitParagraph(element.localName, insertionParent);
		}
		cloneSources[parseContext] = cloneSource;
	}
	//cloneNode is typed as Node; a fragment's clone is a fragment
	return cloneSource.cloneNode(true) as DocumentFragment;
};

//binds a fresh clone from cloneTemplateFragment; the caller inserts it
export const mountInstance = (
	fragment: DocumentFragment,
	values: Array<unknown>,
	parsed: ParsedTemplate,
	treeState: TreeState,
): Instance => {
	const instance = createInstance(parsed, treeState);

	bindFreshClone(document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT), instance, values);
	return instance;
};

export const HYDRATION_MISMATCH: unique symbol = Symbol("hydration mismatch");

export const hydrateInstance = (
	walker: TreeWalker,
	value: TemplateValue,
	parsed: ParsedTemplate,
	rangeEnd: Comment | null,
	treeState: TreeState,
): Instance | typeof HYDRATION_MISMATCH => {
	const instance = createInstance(parsed, treeState);
	for (let bindingIndex = parsed.hostBindingCount; bindingIndex < parsed.bindings.length;) {
		const openMarker = nextOpenMarker(walker, rangeEnd);
		if (openMarker === null) return HYDRATION_MISMATCH;
		const staticBinding = parsed.bindings[bindingIndex];

		if (staticBinding.type !== BINDING.CONTENT) {
			const liveBinding = createMarkedLiveBinding(staticBinding, openMarker);
			hydrateLiveBinding(instance, liveBinding, value.values);
			instance.liveBindings[bindingIndex++] = liveBinding;
			continue;
		}

		const closeMarker = scanToClose(walker, openMarker, staticBinding.closeMarkerData, rangeEnd);
		if (closeMarker === null) return HYDRATION_MISMATCH;
		const liveBinding = createContentLiveBinding(staticBinding, openMarker, closeMarker);
		//the scan left the walker on the close marker, so a nested hydration would start past its
		//own range; this puts it back inside, and the line after the call undoes the descent
		walker.currentNode = openMarker;
		hydrateContent(liveBinding, value.values, instance.treeState, walker);
		instance.liveBindings[bindingIndex++] = liveBinding;
		walker.currentNode = closeMarker;
	}

	return instance;
};
