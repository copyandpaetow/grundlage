import { COMMENT_IDENTIFIER } from "../parser/html-util";
import { EMPTY_EXPRESSIONS } from "./empty-expressions";
import { BINDING_TYPES, ParsedHTML } from "../parser/types";
import { buildFragment } from "./build-fragment";
import { hashValue } from "../utils/hashing";
import { removeAttributeBinding, updateAttribute } from "./attribute";
import { updateContent } from "./content";
import { updateRawContent } from "./raw-content";
import { updateTag } from "./tag";
import { BaseComponent } from "../types";

const updateByType = {
	[BINDING_TYPES.TAG]: updateTag,
	[BINDING_TYPES.ATTR]: updateAttribute,
	[BINDING_TYPES.CONTENT]: updateContent,
	[BINDING_TYPES.RAW_CONTENT]: updateRawContent,
} as const;

//shared placeholders so a freshly constructed template has every field set to its real type from birth; setupTemplate/hydrateTemplate overwrite both with the per-instance arrays once the template is rendered
const EMPTY_TARGETS: Array<Element | Comment> = [];
const EMPTY_DIRTY = new Uint8Array(0);

//HTMLTemplate is a data-only class — fields + constructor, no methods — operated on by the free functions below. it is a class rather than a struct so a template can be told apart from an arbitrary user value by `instanceof` (cheaper than a property brand on the hot hashValue/content path) and constructed via `new`. see CONVENTIONS.md, data-only-class exception
export class HTMLTemplate {
	parsedHTML: ParsedHTML;
	//targets[bindingIndex] lines up with parsedHTML.bindings[bindingIndex] and dirtyBindings[bindingIndex]
	//for ATTR/TAG/RAW_CONTENT bindings we pre-resolve the Element at setup so the hot path doesn't walk the DOM
	//for CONTENT bindings we store the leading Comment marker. the binding still needs it as a range anchor
	//host bindings (first hostBindingOffset entries) resolve straight to the host element, no marker required
	targets: Array<Element | Comment>;
	dirtyBindings: Uint8Array;
	//currentExpressions[expressionIndex] is the expressionIndex-th interpolation in the template literal (the expressionIndex-th `${...}`)
	currentExpressions: Array<unknown>;
	previousExpressions: Array<unknown>;
	//memoized full hash (template shape × expression fold). null until first read; updateTemplate clears it when expressions change. computed lazily by hashTemplate
	hash: number | null;

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
		this.previousExpressions = EMPTY_EXPRESSIONS;
		this.targets = EMPTY_TARGETS;
		this.dirtyBindings = EMPTY_DIRTY;
		this.hash = null;
	}
}

//tells a template apart from an arbitrary user value (string, number, array, object, function, …) in the expression slot — the hot check on the hashValue/content path
export const isTemplate = (value: unknown): value is HTMLTemplate =>
	value instanceof HTMLTemplate;

//lazily computes and caches the full hash. the cache is invalidated in updateTemplate when expressions change
export const hashTemplate = (template: HTMLTemplate): number => {
	if (template.hash === null) {
		const expressions = template.currentExpressions;
		let hash = expressions.length;
		for (let index = 0; index < expressions.length; index++) {
			hash = (Math.imul(hash, 31) + hashValue(expressions[index])) | 0;
		}
		//we XOR-mix shape and content so that `tplA(1, 2)` and `tplB(1, 2)` don't collide
		//a plain add would let a different template with the same expression-fold land on the same hash
		template.hash = template.parsedHTML.templateHash ^ Math.imul(hash, 31);
	}
	return template.hash;
};

export const setupTemplate = (
	template: HTMLTemplate,
	host: BaseComponent | null = null,
): DocumentFragment => {
	const bindingCount = template.parsedHTML.bindings.length;
	template.dirtyBindings = new Uint8Array(bindingCount).fill(1);
	//the parser is document-free, so the first setup of a given template materializes the string seed and caches the template fragment on the shared ParsedHTML; later instances clone it
	const fragmentTemplate =
		template.parsedHTML.fragment ??
		(template.parsedHTML.fragment = buildFragment(template.parsedHTML.result));
	const fragment = fragmentTemplate.cloneNode(true) as DocumentFragment;

	template.targets = findTargets(template, fragment, host);
	flushTemplate(template);

	return fragment;
};

//called by the renderer when we're about to swap to a different template
//host bindings live on the component element itself, so they don't get cleared by replaceChildren. we have to walk this template's host bindings and remove whatever names they last applied before the new template runs setup
export const clearHostAttributes = (
	template: HTMLTemplate,
	host: BaseComponent,
) => {
	const hostBindingOffset = template.parsedHTML.hostBindingOffset;
	const bindings = template.parsedHTML.bindings;
	for (let index = 0; index < hostBindingOffset; index++) {
		//host bindings come from attributes on the root <template>, so the offset range is all ATTR today. guard the cast anyway so a future non-ATTR binding landing in this range can't be force-fed into removeAttributeBinding's shape switch.
		const binding = bindings[index];
		if (binding.type === BINDING_TYPES.ATTR) {
			removeAttributeBinding(host, binding, template.currentExpressions);
		}
	}
};

export const hydrateTemplate = (
	template: HTMLTemplate,
	host: BaseComponent,
) => {
	//Uint8Array is zero-initialized by the spec, so we don't need to fill explicitly
	template.dirtyBindings = new Uint8Array(template.parsedHTML.bindings.length);
	template.targets = findTargets(template, host.shadowRoot!, host);

	//SSR already wrote child elements and their static attrs into the DOM, but the host element's attrs were never serialized. they live in bindings now
	//=> we re-apply every ATTR binding on hydrate so host bindings (and any dynamic child attrs) land on the right element with the current expression values
	for (let index = 0; index < template.parsedHTML.bindings.length; index++) {
		const binding = template.parsedHTML.bindings[index];
		if (binding.type === BINDING_TYPES.ATTR) {
			updateByType[binding.type](template, index);
		}
	}
};

const findTargets = (
	template: HTMLTemplate,
	parent: DocumentFragment | ShadowRoot,
	host: BaseComponent | null,
): Array<Element | Comment> => {
	//host is only threaded in from the runtime's render callback (renderRoot on CSR and SSR); content.ts passes null when setting up nested templates
	//=> a nested literal that happens to be a root template (<template ...> with attributes) lands here with host=null and we reject it with a message naming the actual misuse
	if (template.parsedHTML.hostBindingOffset > 0 && !host) {
		throw new Error(
			"Root template host bindings are only allowed at the top level of a component's render output. `<template ...>` with attributes cannot be used inside ${...} content, list items, or any nested template position.",
		);
	}
	//host bindings come first in `bindings`, so we pre-fill that many entries with the host before walking the DOM for child markers
	const hostBindingOffset = template.parsedHTML.hostBindingOffset;
	const bindings = template.parsedHTML.bindings;
	const targets: Array<Element | Comment> = [];
	for (let hostIndex = 0; hostIndex < hostBindingOffset; hostIndex++) {
		targets.push(host!);
	}

	const treeWalker = document.createTreeWalker(parent, NodeFilter.SHOW_COMMENT);

	let lastMarkerData = "";
	let bindingIndex = hostBindingOffset;
	while (treeWalker.nextNode()) {
		const marker = treeWalker.currentNode as Comment;

		if (!marker.data.startsWith(COMMENT_IDENTIFIER)) {
			continue;
		}

		//content bindings emit two markers carrying identical data (one before and one after the binding's content) so the renderer can find the binding's range
		//=> when we collect markers we only want the first of each pair, so we skip any marker whose data matches the previous one
		if (lastMarkerData === marker.data) {
			continue;
		}
		lastMarkerData = marker.data;

		//ATTR/TAG/RAW_CONTENT just need the element the marker precedes; resolving once at setup spares the per-update .nextElementSibling read
		//CONTENT keeps the marker itself because the binding walks forward to its matching close marker to scope its work
		const type = bindings[bindingIndex++].type;
		targets.push(
			type === BINDING_TYPES.CONTENT ? marker : marker.nextElementSibling!,
		);
	}

	return targets;
};

export const updateTemplate = (
	template: HTMLTemplate,
	expressions: Array<unknown>,
) => {
	const previousExpressions = template.currentExpressions;
	template.previousExpressions = previousExpressions;
	template.currentExpressions = expressions;
	template.hash = null;

	for (let index = 0; index < expressions.length; index++) {
		const currentEntry = expressions[index];

		if (Array.isArray(currentEntry)) {
			template.dirtyBindings[template.parsedHTML.expressionToBinding[index]] =
				1;
			continue;
		}

		const previousEntry = previousExpressions[index];

		if (currentEntry === previousEntry) continue;

		//the `===` check above already settled every primitive (a primitive that didn't match by identity also doesn't match by value)
		//=> the only entries that can still be "equal in content but not in identity" are objects and functions, so only those need the hash-based comparison below
		const currentType = typeof currentEntry;
		const needsContentCompare =
			(currentType === "object" && currentEntry !== null) ||
			currentType === "function";

		if (
			needsContentCompare &&
			hashValue(currentEntry) === hashValue(previousEntry)
		) {
			if (isTemplate(currentEntry)) {
				expressions[index] = previousEntry;
			}
			continue;
		}

		template.dirtyBindings[template.parsedHTML.expressionToBinding[index]] = 1;
	}
	flushTemplate(template);
	//previousExpressions is only read during flush
	//=> we drop the reference so the prior frame's values (possibly large objects) can be collected between renders in long-lived idle components
	template.previousExpressions = EMPTY_EXPRESSIONS;
};

const flushTemplate = (template: HTMLTemplate) => {
	const dirtyBindings = template.dirtyBindings;
	for (
		let bindingIndex = 0;
		bindingIndex < dirtyBindings.length;
		bindingIndex++
	) {
		if (!dirtyBindings[bindingIndex]) continue;
		dirtyBindings[bindingIndex] = 0;
		updateByType[template.parsedHTML.bindings[bindingIndex].type](
			template,
			bindingIndex,
		);
	}
};
