import { AttrBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class AttributeHole {
	binding: AttrBinding;
	pointer: Comment;
	updateId = -1;

	constructor(binding: AttrBinding, pointer: Comment) {
		this.binding = binding;
		this.pointer = pointer;
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;

		const key = this.buildAttribute(this.binding.keys, context.currentValues);
		const previousKey = this.buildAttribute(
			this.binding.keys,
			context.previousValues
		);

		if (this.isEventListener(key, context.currentValues)) {
			if (this.isEventListener(previousKey, context.previousValues)) {
				const previousEvent = previousKey
					.slice(2)
					.toLowerCase() as keyof HTMLElementEventMap;

				this.pointer.nextElementSibling?.removeEventListener(
					previousEvent,
					context.previousValues[
						this.binding.values[0] as number
					] as EventListener
				);
			}

			const event = key.slice(2).toLowerCase() as keyof HTMLElementEventMap;
			this.pointer.nextElementSibling?.removeEventListener(
				event,
				context.currentValues[this.binding.values[0] as number] as EventListener
			);
			return;
		}

		if (
			typeof this.binding.values[0] === "number" &&
			!context.currentValues[this.binding.values[0]]
		) {
			this.pointer.nextElementSibling?.removeAttribute(previousKey);
		}

		const value = this.buildAttribute(
			this.binding.values,
			context.currentValues
		);

		this.pointer.nextElementSibling?.removeAttribute(previousKey);
		this.pointer.nextElementSibling?.setAttribute(key, value);
	}

	buildAttribute(
		fromBinding: Array<number | string>,
		withValues: Array<unknown>
	): string {
		let attr = "";

		for (let index = 0; index < fromBinding.length; index++) {
			const entry = fromBinding[index];
			attr += typeof entry === "number" ? withValues[index] : index;
		}

		return attr;
	}

	isEventListener(key: string, dynamicValues: Array<unknown>) {
		const firstValueIndex = this.binding.values[0];

		const doesKeyStartsWithOn =
			typeof key === "string" && key.slice(0, 2) === "on";

		const isValueAFunction =
			typeof firstValueIndex === "number" &&
			typeof dynamicValues[firstValueIndex] === "function";

		return doesKeyStartsWithOn && isValueAFunction;
	}
}
