import { AttrBinding } from "./html";

export class AttributeHole {
	binding: AttrBinding;
	anchor: Comment;
	event: EventListener | null = null;
	key: keyof HTMLElementEventMap | null = null;

	constructor(
		binding: AttrBinding,
		dynamicValues: Array<unknown>,
		placeholder: HTMLElement
	) {
		this.binding = binding;
		this.anchor = new Comment("attr");

		placeholder.prepend(this.anchor);
		this.update(dynamicValues);
	}

	/*
	? if we have a boolean attribute that changes from something to nothing => it needs to be removed, we dont have a way to target it as we dont have a name anymore
	=> do we need to store them?
	- nested css classes


*/

	update(values: Array<unknown>) {
		if (this.binding.values.length === 0) {
			this.handleBooleanAttribute(this.binding.keys, values);
			return;
		}
		const key = this.binding.keys
			.map((relatedIndex) =>
				typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
			)
			.join("")
			.trim();

		if (
			key.slice(0, 2) === "on" &&
			typeof values[this.binding.values[0]] === "function"
		) {
			this.setEventListener(
				key.slice(2).toLowerCase() as keyof HTMLElementEventMap,
				values[this.binding.values[0]] as EventListener
			);
			return;
		}
		const value = this.binding.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
			)
			.join("");
		this.setAttribute(key, value);
	}

	handleBooleanAttribute(keys: Array<unknown>, values: Array<unknown>) {
		if (keys.length > 1) {
			const key = this.binding.keys
				.map((relatedIndex) =>
					typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
				)
				.join("")
				.trim();

			this.setBooleanAttribute(key);
			return;
		}

		const key = values[keys[0]];

		if (Array.isArray(key)) {
			key.forEach(this.setBooleanAttribute.bind(this));
			return;
		}
		if (typeof key === "object") {
			Object.entries(key).forEach(([attrKey, attrValue]) =>
				this.setAttribute(attrKey, attrValue)
			);
			return;
		}
	}

	setBooleanAttribute(key: string) {
		this.anchor.parentElement!.setAttribute(key, "");
	}

	setAttribute(key: string, value: unknown) {
		if (!value && typeof value !== "number") {
			this.anchor.parentElement!.removeAttribute(key);
			return;
		}
		this.anchor.parentElement!.setAttribute(key, value.toString());
	}

	setEventListener(key: keyof HTMLElementEventMap, callback: EventListener) {
		if (this.event && this.key) {
			this.anchor.parentElement!.removeEventListener(this.key, this.event);
		}
		this.anchor.parentElement!.addEventListener(key, callback);
		this.event = callback;
		this.key = key;
	}
}
