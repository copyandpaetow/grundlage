import { AttributeBinding } from "./attribute";
import { ContentBinding } from "./content";
import { hashValue } from "../utils/hashing";
import {
	BINDING_TYPES,
	MARKER_AMOUNT_END,
	MARKER_AMOUNT_START,
	MARKER_INDEX_END,
	MARKER_INDEX_START,
	ParsedHTML,
} from "../parser/parser-html";
import { RawContentBinding } from "./raw-content";
import { TagBinding } from "./tag";

const EMPTY_ARRAY: Array<unknown> = [];

type Bindings = Array<
	AttributeBinding | TagBinding | ContentBinding | RawContentBinding
>;

export class HTMLTemplate {
	currentExpressions: Array<unknown>;
	previousExpressions: Array<unknown>;
	expressionHashes: Array<number>;
	parsedHTML: ParsedHTML;
	bindings: Bindings;
	expressionsHash = 0;
	updateId = 0;

	constructor(parsedHTML: ParsedHTML, expressions: Array<unknown>) {
		this.parsedHTML = parsedHTML;
		this.currentExpressions = expressions;
		this.previousExpressions = EMPTY_ARRAY;
	}

	setup(): DocumentFragment {
		this.bindings = [];
		this.expressionHashes = this.currentExpressions.map(hashValue);

		const fragment = this.parsedHTML.fragment.cloneNode(
			true,
		) as DocumentFragment;

		const treeWalker = document.createTreeWalker(
			fragment,
			NodeFilter.SHOW_COMMENT,
			{ acceptNode: () => NodeFilter.FILTER_ACCEPT },
		);

		let lastIndex = -1;
		while (treeWalker.nextNode()) {
			const marker = treeWalker.currentNode as Comment;

			const index = parseInt(
				marker.substringData(MARKER_INDEX_START, MARKER_INDEX_END),
			);
			const amount = parseInt(
				marker.substringData(MARKER_AMOUNT_START, MARKER_AMOUNT_END),
			);

			//content nodes are there twice with the same index, so we can filter them here
			if (isNaN(index) || index === lastIndex) {
				continue;
			}

			const descriptor = this.parsedHTML.descriptors[index];
			let binding:
				| AttributeBinding
				| TagBinding
				| ContentBinding
				| RawContentBinding;

			switch (descriptor.type) {
				case BINDING_TYPES.ATTR:
					binding = new AttributeBinding(descriptor, marker);
					break;
				case BINDING_TYPES.TAG:
					binding = new TagBinding(descriptor, marker);
					break;
				case BINDING_TYPES.CONTENT:
					binding = new ContentBinding(descriptor, marker);
					break;
				case BINDING_TYPES.RAW_CONTENT:
					binding = new RawContentBinding(descriptor, marker);
					break;

				default:
					throw new Error("unknown type");
			}
			binding.update(this);

			for (let amountIndex = 0; amountIndex < amount; amountIndex++) {
				this.bindings.push(binding);
			}

			lastIndex = index;
		}
		return fragment;
	}

	update(expressions: Array<unknown>) {
		this.previousExpressions = this.currentExpressions;
		this.currentExpressions = expressions;

		const nextId = this.updateId + 1;
		for (let index = 0; index < this.currentExpressions.length; index++) {
			const previousHash = this.expressionHashes[index];
			const currentHash = hashValue(this.currentExpressions[index]);

			if (previousHash === currentHash) continue;

			this.expressionHashes[index] = currentHash;
			this.updateId = nextId;
			this.bindings[index].update(this);
		}

		this.expressionsHash = 0;

		for (const hash of this.expressionHashes) {
			this.expressionsHash = (this.expressionsHash * 31 + hash) | 0;
		}
	}
}
