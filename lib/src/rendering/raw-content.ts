import { RawContentDescriptor } from "../parser/parser-html";
import { HTMLTemplate } from "./template-html";

export class RawContentBinding {
	#descriptor: RawContentDescriptor;
	#marker: Comment;
	#updateId = -1;

	constructor(descriptor: RawContentDescriptor, marker: Comment) {
		this.#descriptor = descriptor;
		this.#marker = marker;
	}

	update(context: HTMLTemplate) {
		if (this.#updateId === context.updateId) {
			return;
		}
		this.#updateId = context.updateId;

		let rawTextContent = "";
		for (let index = 0; index < this.#descriptor.values.length; index++) {
			const entry = this.#descriptor.values[index];
			rawTextContent +=
				typeof entry === "string"
					? entry
					: this.#toString(context.currentExpressions[entry]);
		}
		this.#marker.nextElementSibling!.textContent = rawTextContent;
	}

	#toString(value: unknown): string {
		if (!value && typeof value !== "number") {
			return "";
		}
		if (typeof value === "function") {
			return this.#toString(value());
		}
		return value.toString();
	}
}
