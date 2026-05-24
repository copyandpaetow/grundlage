import { COMMENT_IDENTIFIER } from "../parser/html-util";
import { AttributeBinding, BINDING_TYPES, ParsedHTML } from "../parser/types";
import { hashValue } from "../utils/hashing";
import { removeAttributeBinding, updateAttribute } from "./attribute";
import { updateContent } from "./content";
import { updateRawContent } from "./raw-content";
import { updateTag } from "./tag";
import { BaseComponent } from "../types";

const EMPTY_ARRAY: Array<unknown> = [] as const;

const updateByType = {
	[BINDING_TYPES.TAG]: updateTag,
	[BINDING_TYPES.ATTR]: updateAttribute,
	[BINDING_TYPES.CONTENT]: updateContent,
	[BINDING_TYPES.RAW_CONTENT]: updateRawContent,
} as const;

export class HTMLTemplate {
	#hash: number | undefined;
	parsedHTML: ParsedHTML;
	//targets[bindingIndex] lines up with parsedHTML.bindings[bindingIndex] and dirtyBindings[bindingIndex]
	//for ATTR/TAG/RAW_CONTENT bindings we pre-resolve the Element at setup so the hot path doesn't walk the DOM
	//for CONTENT bindings we store the leading Comment marker. the binding still needs it as a range anchor
	//host bindings (first hostBindingOffset entries) resolve straight to the host element, no marker required
	targets: Array<Element | Comment>;
	dirtyBindings: Uint8Array;
	//currentExpressions[expressionIndex] is the expressionIndex-th interpolation in the template literal (the expressionIndex-th `${...}`)
	currentExpressions: Array<unknown>;
	previousExpressions = EMPTY_ARRAY;

	//we cache this per-update and invalidate in update() when expressions change
	get hash(): number {
		if (this.#hash === undefined) {
			const expressions = this.currentExpressions;
			let hash = expressions.length;
			for (let index = 0; index < expressions.length; index++) {
				hash = (Math.imul(hash, 31) + hashValue(expressions[index])) | 0;
			}
			//we XOR-mix shape and content so that `tplA(1, 2)` and `tplB(1, 2)` don't collide
			//a plain add would let a different template with the same expression-fold land on the same hash
			this.#hash = this.parsedHTML.templateHash ^ Math.imul(hash, 31);
		}
		return this.#hash;
	}

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
	}

	setup(host: BaseComponent | null = null): DocumentFragment {
		const bindingCount = this.parsedHTML.bindings.length;
		this.dirtyBindings = new Uint8Array(bindingCount).fill(1);
		const fragment = this.parsedHTML.fragment.cloneNode(
			true,
		) as DocumentFragment;

		this.targets = this.#findTargets(fragment, host);
		this.#flush();

		return fragment;
	}

	//called by the renderer when we're about to swap to a different template
	//host bindings live on the component element itself, so they don't get cleared by replaceChildren. we have to walk this template's host bindings and remove whatever names they last applied before the new template runs setup()
	clearHostAttributes(host: BaseComponent) {
		const hostBindingOffset = this.parsedHTML.hostBindingOffset;
		const bindings = this.parsedHTML.bindings;
		for (let index = 0; index < hostBindingOffset; index++) {
			removeAttributeBinding(
				host,
				bindings[index] as AttributeBinding,
				this.currentExpressions,
			);
		}
	}

	hydrate(host: BaseComponent) {
		//Uint8Array is zero-initialized by the spec, so we don't need to fill explicitly
		this.dirtyBindings = new Uint8Array(this.parsedHTML.bindings.length);
		this.targets = this.#findTargets(host.shadowRoot!, host);

		//SSR already wrote child elements and their static attrs into the DOM, but the host element's attrs were never serialized. they live in bindings now
		//=> we re-apply every ATTR binding on hydrate so host bindings (and any dynamic child attrs) land on the right element with the current expression values
		for (let index = 0; index < this.parsedHTML.bindings.length; index++) {
			const binding = this.parsedHTML.bindings[index];
			if (binding.type === BINDING_TYPES.ATTR) {
				updateByType[binding.type](this, index);
			}
		}
	}

	#findTargets(
		parent: DocumentFragment | ShadowRoot,
		host: BaseComponent | null,
	): Array<Element | Comment> {
		//host is only threaded in from the runtime's render callback (renderTemplate on CSR, renderOnce on SSR); content.ts passes null when setting up nested templates
		//=> a nested literal that happens to be a root template (<template ...> with attributes) lands here with host=null and we reject it with a message naming the actual misuse
		if (this.parsedHTML.hostBindingOffset > 0 && !host) {
			throw new Error(
				"Root template host bindings are only allowed at the top level of a component's render output. `<template ...>` with attributes cannot be used inside ${...} content, list items, or any nested template position.",
			);
		}
		//host bindings come first in `bindings`, so we pre-fill that many entries with the host before walking the DOM for child markers
		const hostBindingOffset = this.parsedHTML.hostBindingOffset;
		const bindings = this.parsedHTML.bindings;
		const targets: Array<Element | Comment> = [];
		for (let hostIndex = 0; hostIndex < hostBindingOffset; hostIndex++) {
			targets.push(host!);
		}

		const treeWalker = document.createTreeWalker(
			parent,
			NodeFilter.SHOW_COMMENT,
		);

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
	}

	update(expressions: Array<unknown>) {
		const previousExpressions = this.currentExpressions;
		this.previousExpressions = previousExpressions;
		this.currentExpressions = expressions;
		this.#hash = undefined;

		for (let index = 0; index < expressions.length; index++) {
			const currentEntry = expressions[index];
			const previousEntry = previousExpressions[index];

			if (currentEntry === previousEntry) continue;

			//the `===` check above already settled every primitive (a primitive that didn't match by identity also doesn't match by value)
			//=> the only entries that can still be "equal in content but not in identity" are objects and functions, so only those need the hash-based comparison below
			const currentType = typeof currentEntry;
			const needsContentCompare =
				(currentType === "object" && currentEntry !== null) ||
				currentType === "function";

			//arrays are reconciled per-item inside renderList via hash-based identity matching
			//if we hashed the whole list here we would walk every item only for renderList to walk them again
			//=> we just mark dirty and let the one place that needs the per-item compare do it
			if (Array.isArray(currentEntry)) {
				this.dirtyBindings[this.parsedHTML.expressionToBinding[index]] = 1;
				continue;
			}

			if (
				needsContentCompare &&
				hashValue(currentEntry) === hashValue(previousEntry)
			) {
				if (currentEntry instanceof HTMLTemplate) {
					expressions[index] = previousEntry;
				}
				continue;
			}

			this.dirtyBindings[this.parsedHTML.expressionToBinding[index]] = 1;
		}
		this.#flush();
		//previousExpressions is only read during #flush
		//=> we drop the reference so the prior frame's values (possibly large objects) can be collected between renders in long-lived idle components
		this.previousExpressions = EMPTY_ARRAY;
	}

	#flush() {
		const dirtyBindings = this.dirtyBindings;
		for (
			let bindingIndex = 0;
			bindingIndex < dirtyBindings.length;
			bindingIndex++
		) {
			if (!dirtyBindings[bindingIndex]) continue;
			dirtyBindings[bindingIndex] = 0;
			updateByType[this.parsedHTML.bindings[bindingIndex].type](
				this,
				bindingIndex,
			);
		}
	}
}
