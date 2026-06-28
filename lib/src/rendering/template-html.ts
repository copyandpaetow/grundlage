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

const EMPTY_TARGETS: Array<Element | Comment> = [];
const EMPTY_DIRTY = new Uint8Array(0);
const EMPTY_EXPRESSION_HASHES = new Float64Array(0);
export const EMPTY_LIST_ITEM_HASHES: Array<Array<number>> = [];

const UNHASHED = NaN;

export class HTMLTemplate {
	parsedHTML: ParsedHTML;
	targets: Array<Element | Comment>;
	dirtyBindings: Uint8Array;
	expressionHashes: Float64Array;
	listItemHashes: Array<Array<number>>;
	currentExpressions: Array<unknown>;
	previousExpressions: Array<unknown>;
	hash: number | null;

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
		this.previousExpressions = EMPTY_EXPRESSIONS;
		this.targets = EMPTY_TARGETS;
		this.dirtyBindings = EMPTY_DIRTY;
		this.expressionHashes = EMPTY_EXPRESSION_HASHES;
		this.listItemHashes = EMPTY_LIST_ITEM_HASHES;
		this.hash = null;
	}
}

export const isTemplate = (value: unknown): value is HTMLTemplate =>
	value instanceof HTMLTemplate;

export const hashTemplate = (template: HTMLTemplate): number => {
	if (template.hash === null) {
		const expressions = template.currentExpressions;
		let hash = expressions.length;
		for (let index = 0; index < expressions.length; index++) {
			hash = (Math.imul(hash, 31) + hashValue(expressions[index])) | 0;
		}
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
	template.expressionHashes = new Float64Array(
		template.currentExpressions.length,
	).fill(UNHASHED);
	const fragmentTemplate =
		template.parsedHTML.fragment ??
		(template.parsedHTML.fragment = buildFragment(template.parsedHTML.result));
	const fragment = fragmentTemplate.cloneNode(true) as DocumentFragment;

	template.targets = findTargets(template, fragment, host);
	flushTemplate(template);

	return fragment;
};

export const clearHostAttributes = (
	template: HTMLTemplate,
	host: BaseComponent,
) => {
	const hostBindingOffset = template.parsedHTML.hostBindingOffset;
	const bindings = template.parsedHTML.bindings;
	for (let index = 0; index < hostBindingOffset; index++) {
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
	template.dirtyBindings = new Uint8Array(template.parsedHTML.bindings.length);
	template.expressionHashes = new Float64Array(
		template.currentExpressions.length,
	).fill(UNHASHED);
	template.targets = findTargets(template, host.shadowRoot!, host);

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
	if (template.parsedHTML.hostBindingOffset > 0 && !host) {
		throw new Error(
			"Root template host bindings are only allowed at the top level of a component's render output. `<template ...>` with attributes cannot be used inside ${...} content, list items, or any nested template position.",
		);
	}
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

		if (lastMarkerData === marker.data) {
			continue;
		}
		lastMarkerData = marker.data;

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

	const expressionHashes = template.expressionHashes;
	for (let index = 0; index < expressions.length; index++) {
		const currentEntry = expressions[index];

		if (Array.isArray(currentEntry)) {
			const currentHash = hashValue(currentEntry);
			if (currentHash !== expressionHashes[index]) {
				expressionHashes[index] = currentHash;
				template.dirtyBindings[template.parsedHTML.expressionToBinding[index]] =
					1;
			}
			continue;
		}

		const previousEntry = previousExpressions[index];

		if (currentEntry === previousEntry) continue;

		const currentType = typeof currentEntry;
		const needsContentCompare =
			(currentType === "object" && currentEntry !== null) ||
			currentType === "function";

		if (needsContentCompare) {
			const currentHash = hashValue(currentEntry);
			const matchesPrevious = currentHash === expressionHashes[index];
			expressionHashes[index] = currentHash;
			if (matchesPrevious) {
				if (isTemplate(currentEntry)) {
					expressions[index] = previousEntry;
				}
				continue;
			}
			template.dirtyBindings[template.parsedHTML.expressionToBinding[index]] =
				1;
			continue;
		}

		expressionHashes[index] = UNHASHED;
		template.dirtyBindings[template.parsedHTML.expressionToBinding[index]] = 1;
	}
	flushTemplate(template);
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
