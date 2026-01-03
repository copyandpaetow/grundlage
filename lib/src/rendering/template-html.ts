import { AttributeHole } from "./attributes";
import { ContentHole } from "./content";
import { hashValue } from "./hashing";
import { BINDING_TYPES, Bindings } from "./parser-html";
import { RawContentHole } from "./raw-content";
import { TagHole } from "./tags";

const EMPTY_ARRAY: Array<unknown> = [];

export class HTMLTemplate {
	currentValues: Array<unknown>;
	previousValues: Array<unknown>;
	templateResult: Bindings;
	bindings: Array<AttributeHole | TagHole | ContentHole | RawContentHole> = [];
	valueHash = 0;
	updateId = 0;

	constructor(templateResult: Bindings, dynamicValues: Array<unknown>) {
		this.currentValues = dynamicValues;
		this.templateResult = templateResult;
		this.previousValues = EMPTY_ARRAY;
	}

	setup(): DocumentFragment {
		const fragment = this.templateResult.fragment.cloneNode(
			true
		) as DocumentFragment;

		const treeWalker = document.createTreeWalker(
			fragment,
			NodeFilter.SHOW_COMMENT,
			{ acceptNode: () => NodeFilter.FILTER_ACCEPT }
		);

		let lastIndex = -1;
		while (treeWalker.nextNode()) {
			const node = treeWalker.currentNode as Comment;
			const index = parseInt(node.substringData(3, 4));
			const amount = parseInt(node.substringData(5, 6));

			//content nodes are there twice with the same index, so we can filter them here
			if (isNaN(index) || index === lastIndex) {
				continue;
			}

			const binding = this.templateResult.binding[index];
			let result: AttributeHole | TagHole | ContentHole | RawContentHole;

			switch (binding.type) {
				case BINDING_TYPES.ATTR:
					result = new AttributeHole(binding, node);
					break;
				case BINDING_TYPES.TAG:
					result = new TagHole(binding, node);
					break;
				case BINDING_TYPES.CONTENT:
					result = new ContentHole(binding, node);
					break;
				case BINDING_TYPES.RAW_CONTENT:
					result = new RawContentHole(binding, node);
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

	update(values: Array<unknown>): boolean {
		this.previousValues = this.currentValues;
		this.currentValues = values;

		const nextId = this.updateId + 1;
		for (let index = 0; index < this.currentValues.length; index++) {
			const previous = this.previousValues[index];
			const current = this.currentValues[index];

			if (previous !== current) {
				this.updateId = nextId;
				this.bindings[index].update(this);
			}
		}

		if (this.updateId !== nextId) {
			return false;
		}

		this.valueHash = hashValue(values);

		return true;
	}
}
