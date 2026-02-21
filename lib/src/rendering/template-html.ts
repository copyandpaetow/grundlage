import { COMMENT_IDENTIFIER } from "../parser/html-util";
import { BINDING_TYPES, ParsedHTML } from "../parser/types";
import { hashValue } from "../utils/hashing";
import { updateAttribute } from "./attribute";
import { updateContent } from "./content";
import { updateRawContent } from "./raw-content";
import { updateTag } from "./tag";

const EMPTY_ARRAY: Array<unknown> = [] as const;

const updateByType = {
	[BINDING_TYPES.TAG]: updateTag,
	[BINDING_TYPES.ATTR]: updateAttribute,
	[BINDING_TYPES.CONTENT]: updateContent,
	[BINDING_TYPES.RAW_CONTENT]: updateRawContent,
} as const;

export class HTMLTemplate {
	hash = 0;
	parsedHTML: ParsedHTML;
	//these are tied together by the index position of the individual bindings
	markers: Array<Comment>;
	dirtyBindings: Set<number>;
	//these are tied together by the index position of the individual expressions
	currentExpressions: Array<unknown>;
	previousExpressions = EMPTY_ARRAY;

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
		this.hash = expressions.length;

		for (const value of this.currentExpressions) {
			const hash = hashValue(value);
			this.hash = (this.hash * 31 + hash) | 0;
		}

		this.hash = this.parsedHTML.templateHash ^ (this.hash * 31);
	}

	setup(): DocumentFragment {
		this.dirtyBindings = new Set(this.parsedHTML.expressionToBinding);
		const fragment = this.parsedHTML.fragment.cloneNode(
			true,
		) as DocumentFragment;

		this.markers = this.#findMarkers(fragment);
		this.#flush();

		return fragment;
	}

	hydrate(context: ShadowRoot) {
		this.dirtyBindings = new Set();
		this.markers = this.#findMarkers(context);

		for (let index = 0; index < this.parsedHTML.bindings.length; index++) {
			const binding = this.parsedHTML.bindings[index];
			if (binding.type === BINDING_TYPES.ATTR) {
				updateByType[binding.type](this, index);
			}
		}
	}

	#findMarkers(parent: DocumentFragment | ShadowRoot) {
		const markers = [];
		const treeWalker = document.createTreeWalker(
			parent,
			NodeFilter.SHOW_COMMENT,
			{ acceptNode: () => NodeFilter.FILTER_ACCEPT },
		);

		let lastBindingIndex = "";
		while (treeWalker.nextNode()) {
			const marker = treeWalker.currentNode as Comment;

			if (!marker.data.startsWith(COMMENT_IDENTIFIER)) {
				continue;
			}

			//content nodes are there twice with the same index, so we can filter them here
			if (lastBindingIndex === marker.data) {
				continue;
			}
			lastBindingIndex = marker.data;
			markers.push(marker);
		}

		return markers;
	}

	update(expressions: Array<unknown>) {
		this.previousExpressions = this.currentExpressions ?? EMPTY_ARRAY;
		this.currentExpressions = expressions;
		this.hash = expressions.length;

		for (let index = 0; index < expressions.length; index++) {
			const currentEntry = this.currentExpressions[index];
			const previousEntry = this.previousExpressions[index];
			const currentHash = hashValue(currentEntry);
			this.hash = (this.hash * 31 + currentHash) | 0;

			if (currentEntry === previousEntry) {
				continue;
			}

			if (currentHash === hashValue(previousEntry)) {
				if (this.currentExpressions[index] instanceof HTMLTemplate) {
					this.currentExpressions[index] = this.previousExpressions[index];
				}
				continue;
			}

			this.dirtyBindings.add(this.parsedHTML.expressionToBinding[index]);
		}
		this.#flush();
	}

	#flush() {
		for (const bindingIndex of this.dirtyBindings) {
			updateByType[this.parsedHTML.bindings[bindingIndex].type](
				this,
				bindingIndex,
			);
		}
		this.dirtyBindings.clear();
	}
}
