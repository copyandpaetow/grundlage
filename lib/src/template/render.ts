import { remove } from "../mount/helper";
import {
	AttrBinding,
	MixedArray,
	Result,
	TagBinding,
	TextBinding,
} from "./html";
import { createEffect } from "./signals";

/*

TODO: query for template elements and replace their content with the children and add the active value from the special properties

TODO: render differently depending on the result of the dynamic value
=> needs a recursive render strategy

*/

export const textRender = (
	binding: TextBinding,
	result: Result,
	activeValue = () => undefined
) => {
	const placeholder = result.fragment.querySelector(
		`[data-replace="${binding.id}"]`
	) as HTMLElement;

	if (!placeholder) {
		return;
	}

	const start = new Comment("start");
	const end = new Comment("end");
	placeholder.replaceWith(start, end);

	createEffect(() => {
		const replacement = document.createTextNode(
			result.dynamicValues[binding.value[0]].toString() ?? ""
		);
		remove(start, end);
		start.after(replacement);
	});
};

export const tagRender = (
	binding: TagBinding,
	result: Result,
	activeValue = () => undefined
) => {
	const placeholder = result.fragment.querySelector(
		`[data-replace="${binding.id}"]`
	) as Element;

	if (!placeholder) {
		return;
	}

	createEffect(() => {
		const newTag = binding.value
			.map((tagPart) =>
				typeof tagPart === "number"
					? result.dynamicValues[tagPart].toString()
					: tagPart
			)
			.join("");

		const newElement = document.createElement(newTag);
		placeholder
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, placeholder.getAttribute(name)!)
			);

		newElement.replaceChildren(...placeholder.childNodes);
		placeholder.replaceWith(newElement);
	});
};

export const attributeRender = (
	binding: AttrBinding,
	result: Result,
	activeValue = () => undefined
) => {
	const placeholder = result.fragment.querySelector(
		`[data-replace="${binding.id}"]`
	) as Element;

	const attrPointer = new Comment("attr start above");
	placeholder.append(attrPointer);

	console.log(binding);
	if (
		binding.value.length === 0 &&
		binding.key.length === 1 &&
		typeof binding.key[0] === "number"
	) {
		const soleValue = result.dynamicValues[binding.key[0]];
		if (typeof soleValue === "object") {
			if (Array.isArray(soleValue) || soleValue instanceof Set) {
				soleValue.forEach((key) =>
					createEffect(() => {
						attrPointer.parentElement!.setAttribute(key, "");
					})
				);
				return;
			}

			(soleValue instanceof Map
				? soleValue
				: Object.entries(soleValue)
			).forEach(([key, value]) =>
				createEffect(() => {
					attrPointer.parentElement!.setAttribute(key, value);
				})
			);
		}
	} else {
		createEffect(() => {
			const key = binding.key
				.map((keyPart) =>
					typeof keyPart === "number"
						? result.dynamicValues[keyPart].toString()
						: keyPart
				)
				.join("");

			const value = binding.value
				.map((valuePart) =>
					typeof valuePart === "number"
						? result.dynamicValues[valuePart].toString()
						: valuePart
				)
				.join("");

			attrPointer.parentElement!.setAttribute(key, value);
		});
	}
};
