import { ParsedHTML } from "../parser/parser-html";
import { hashValue } from "../utils/hashing";
import { updateAttribute } from "./attribute";
import { updateContent } from "./content";
import { updateRawContent } from "./raw-content";
import { updateTag } from "./tag";

const EMPTY_ARRAY: Array<unknown> = [];

const updateByType = [
	updateTag,
	updateAttribute,
	updateContent,
	updateRawContent,
] as const;

export class HTMLTemplate {
	hash = 0;
	parsedHTML: ParsedHTML;
	markers: Array<Comment>;
	dirtyBindings: Set<number>;
	expressionHashes: Array<number>;
	currentExpressions: Array<unknown>;
	previousExpressions: Array<unknown>;

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = EMPTY_ARRAY;
		this.previousExpressions = EMPTY_ARRAY;
		this.expressionHashes = [];

		this.setExpressions(expressions);
	}

	setup(): DocumentFragment {
		this.markers = [];
		this.dirtyBindings = new Set(this.parsedHTML.descriptorToBindings);

		const fragment = this.parsedHTML.fragment.cloneNode(
			true,
		) as DocumentFragment;

		const treeWalker = document.createTreeWalker(
			fragment,
			NodeFilter.SHOW_COMMENT,
			{ acceptNode: () => NodeFilter.FILTER_ACCEPT },
		);

		let lastDescriptorIndex = "";
		while (treeWalker.nextNode()) {
			const marker = treeWalker.currentNode as Comment;

			//content nodes are there twice with the same index, so we can filter them here
			if (lastDescriptorIndex === marker.data) {
				continue;
			}
			lastDescriptorIndex = marker.data;
			this.markers.push(marker);
		}

		this.flush();

		return fragment;
	}

	setExpressions(expressions: Array<unknown>) {
		this.previousExpressions = this.currentExpressions;
		this.currentExpressions = expressions;
		this.hash = 0;

		for (const value of this.currentExpressions) {
			const hash = hashValue(value);
			this.expressionHashes.push(hash);
			this.hash = (this.hash * 31 + hash) | 0;
		}

		this.hash = this.parsedHTML.templateHash ^ (this.hash * 31);
	}

	update(expressions: Array<unknown>) {
		const previousHashes = this.expressionHashes;
		this.setExpressions(expressions);

		for (let index = 0; index < previousHashes.length; index++) {
			const currentHash = this.expressionHashes[index];
			const previousHash = previousHashes[index];

			if (previousHash === currentHash) {
				if (this.currentExpressions[index] instanceof HTMLTemplate) {
					this.currentExpressions[index] = this.previousExpressions;
				}
				continue;
			}
			this.dirtyBindings.add(index);
		}
		this.flush();
	}

	flush() {
		for (const bindingIndex of this.dirtyBindings) {
			updateByType[this.parsedHTML.descriptors[bindingIndex].type](
				this,
				bindingIndex,
			);
		}
		this.dirtyBindings.clear();
	}
}
