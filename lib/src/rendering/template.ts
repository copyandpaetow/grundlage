import { hashValue } from "./hashing";
import { AttrBinding, Bindings, TagBinding } from "./html";
import { AttributeHole } from "./attributes";
import { ContentHole } from "./content";
import { TagHole } from "./tags";

/*
* it is still unclear if it is better to use one general array vs 3 specific arrays
- the difference in code would be small, we would trade memory vs iteration purity
*/

export class HTMLTemplate {
	dynamicValues: Array<unknown>;
	templateResult: Bindings;
	bindings: Array<TagHole | AttributeHole | ContentHole>;
	valueHash: number = 0;

	constructor(templateResult: Bindings, dynamicValues: Array<unknown>) {
		this.dynamicValues = dynamicValues;
		this.templateResult = templateResult;
	}

	setup(): DocumentFragment {
		const fragment = this.templateResult.fragment.cloneNode(
			true
		) as DocumentFragment;

		this.bindings = new Array(this.dynamicValues.length);

		for (let index = 0; index < this.templateResult.binding.length; index++) {
			const binding = this.templateResult.binding[index];
			const placeholder = fragment.querySelector(
				`[data-replace-${index}]`
			) as HTMLElement;

			if (typeof binding === "number") {
				this.bindings[binding] = new ContentHole(
					binding,
					this.dynamicValues,
					placeholder
				);
				continue;
			}
			if (!binding.hasOwnProperty("keys")) {
				const tagBinding = new TagHole(
					binding as TagBinding,
					this.dynamicValues,
					placeholder
				);

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

			const attrBinding = new AttributeHole(
				binding as AttrBinding,
				this.dynamicValues,
				placeholder
			);

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
		if (!this.valueHash) {
			this.valueHash = hashValue(this.dynamicValues);
		}
		const currentHash = hashValue(values);

		if (this.valueHash === currentHash) {
			return false;
		}

		for (let index = 0; index < this.dynamicValues.length; index++) {
			const previous = this.dynamicValues[index];
			const current = values[index];

			if (previous !== current) {
				this.bindings[index].update(values);
			}
		}

		this.valueHash = currentHash;
		this.dynamicValues = values;

		return true;
	}
}
