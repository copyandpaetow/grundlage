import { hashValue } from "./hashing";
import { AttrBinding, Bindings, TagBinding } from "./parser-html";
import { AttributeHole } from "./attributes";
import { ContentHole } from "./content";
import { TagHole } from "./tags";

const EMPTY_ARRAY: Array<unknown> = [];

export class HTMLTemplate {
	currentValues: Array<unknown>;
	previousValues: Array<unknown>;
	templateResult: Bindings;
	bindings: Array<TagHole | AttributeHole | ContentHole>;
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

		this.bindings = new Array(this.currentValues.length);

		for (let index = 0; index < this.templateResult.binding.length; index++) {
			const binding = this.templateResult.binding[index];
			const selector = `data-replace-${index}`;
			const placeholder = fragment.querySelector(
				`[${selector}]`
			) as HTMLElement;

			placeholder.removeAttribute(selector);

			if (typeof binding === "number") {
				const contentBinding = new ContentHole(binding);
				contentBinding.setup(placeholder, this);
				this.bindings[binding] = contentBinding;
				continue;
			}
			if (!binding.hasOwnProperty("keys")) {
				const tagBinding = new TagHole(binding as TagBinding);
				tagBinding.setup(placeholder, this);

				for (const value of binding.values) {
					if (typeof value === "number") {
						this.bindings[value] = tagBinding;
					}
				}

				for (const value of (binding as TagBinding).endValues) {
					if (typeof value === "number") {
						this.bindings[value] = tagBinding;
					}
				}
				continue;
			}

			const attrBinding = new AttributeHole(binding as AttrBinding);
			attrBinding.setup(placeholder, this);

			for (const value of binding.values) {
				if (typeof value === "number") {
					this.bindings[value] = attrBinding;
				}
			}

			for (const value of (binding as AttrBinding).keys) {
				if (typeof value === "number") {
					this.bindings[value] = attrBinding;
				}
			}
		}

		return fragment;
	}

	update(values: Array<unknown>): boolean {
		this.previousValues = this.currentValues;
		this.currentValues = values;

		if (!this.valueHash) {
			this.valueHash = hashValue(this.currentValues);
		}
		const currentHash = hashValue(values);

		if (this.valueHash === currentHash) {
			return false;
		}

		this.updateId++;
		for (let index = 0; index < this.currentValues.length; index++) {
			const previous = this.currentValues[index];
			const current = values[index];

			if (previous !== current) {
				this.bindings[index].update(this);
			}
		}

		this.valueHash = currentHash;

		return true;
	}
}
