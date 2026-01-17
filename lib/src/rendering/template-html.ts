import { AttributeBinding } from "./attribute";
import { ContentBinding } from "./content";
import { hashValue } from "../utils/hashing";
import { BINDING_TYPES, ParsedHTML } from "../parser/parser-html";
import { RawContentBinding } from "./raw-content";
import { TagBinding } from "./tag";

const EMPTY_ARRAY: Array<unknown> = [];

export class HTMLTemplate {
	currentExpressions: Array<unknown>;
	previousExpressions: Array<unknown>;
	parsedHTML: ParsedHTML;
	bindings: Array<
		AttributeBinding | TagBinding | ContentBinding | RawContentBinding
	> = [];
	expressionsHash = 0;
	updateId = 0;

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
		this.previousExpressions = EMPTY_ARRAY;
	}

	setup(): DocumentFragment {
		const fragment = this.parsedHTML.fragment.cloneNode(
			true
		) as DocumentFragment;

		const treeWalker = document.createTreeWalker(
			fragment,
			NodeFilter.SHOW_COMMENT,
			{ acceptNode: () => NodeFilter.FILTER_ACCEPT }
		);

		let lastIndex = -1;
		while (treeWalker.nextNode()) {
			const pointer = treeWalker.currentNode as Comment;
			const index = parseInt(pointer.substringData(3, 4));
			const amount = parseInt(pointer.substringData(5, 6));

			//content nodes are there twice with the same index, so we can filter them here
			if (isNaN(index) || index === lastIndex) {
				continue;
			}

			const binding = this.parsedHTML.descriptors[index];
			let result:
				| AttributeBinding
				| TagBinding
				| ContentBinding
				| RawContentBinding;

			switch (binding.type) {
				case BINDING_TYPES.ATTR:
					result = new AttributeBinding(binding, pointer);
					break;
				case BINDING_TYPES.TAG:
					result = new TagBinding(binding, pointer);
					break;
				case BINDING_TYPES.CONTENT:
					result = new ContentBinding(binding, pointer);
					break;
				case BINDING_TYPES.RAW_CONTENT:
					result = new RawContentBinding(binding, pointer);
					break;

				default:
					throw new Error("unknown type");
			}
			result.update(this);

			for (let amountIndex = 0; amountIndex < amount; amountIndex++) {
				this.bindings.push(result);
			}

			lastIndex = index;
		}
		return fragment;
	}

	update(expressions: Array<unknown>): boolean {
		this.previousExpressions = this.currentExpressions;
		this.currentExpressions = expressions;

		const nextId = this.updateId + 1;
		for (let index = 0; index < this.currentExpressions.length; index++) {
			const previous = this.previousExpressions[index];
			const current = this.currentExpressions[index];

			if (previous === current) {
				continue;
			}

			if (
				previous instanceof HTMLTemplate &&
				current instanceof HTMLTemplate &&
				previous.parsedHTML.templateHash === current.parsedHTML.templateHash &&
				previous.expressionsHash === current.expressionsHash
			) {
				continue;
			}

			this.updateId = nextId;
			this.bindings[index].update(this);
		}

		if (this.updateId !== nextId) {
			return false;
		}

		this.expressionsHash = hashValue(this.currentExpressions);

		return true;
	}
}
