import { AttributeBinding } from "./attribute";
import { ContentBinding } from "./content";
import { hashValue } from "../utils/hashing";
import {
	BINDING_TYPES,
	COMMENT_DELIMMITER,
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

		this.expressionHashes = [];
		for (const value of this.currentExpressions) {
			const hash = hashValue(value);
			this.expressionHashes.push(hash);
			this.expressionsHash = (this.expressionsHash * 31 + hash) | 0;
		}
	}

	setup(): DocumentFragment {
		this.bindings = [];

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
			const [descriptorIndex, bindingIndices] =
				marker.data.split(COMMENT_DELIMMITER);

			//content nodes are there twice with the same index, so we can filter them here
			if (lastDescriptorIndex === descriptorIndex) {
				continue;
			}
			lastDescriptorIndex = descriptorIndex;

			const descriptor = this.parsedHTML.descriptors[Number(descriptorIndex)];

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

			for (const bindingIndex of bindingIndices.split(",")) {
				this.bindings[Number(bindingIndex)] = binding;
			}
		}

		for (const binding of this.bindings) {
			binding.update(this);
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

			if (previousHash === currentHash) {
				if (this.currentExpressions[index] instanceof HTMLTemplate) {
					this.currentExpressions[index] = this.previousExpressions;
				}
				continue;
			}

			this.expressionHashes[index] = currentHash;
			this.updateId = nextId;
			this.bindings[index].update(this);
			//todo: can this be an issue when the first value is rehashed but a potential additional value related to the same binding here is not?
		}

		this.expressionsHash = 0;

		for (const hash of this.expressionHashes) {
			this.expressionsHash = (this.expressionsHash * 31 + hash) | 0;
		}
	}
}
