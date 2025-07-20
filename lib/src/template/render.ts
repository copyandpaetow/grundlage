import { remove } from "../mount/helper";
import { ForEachComponent } from "./for-component";
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

export const updateDynamicParts = (
	result: Result,
	activeValue = () => undefined
) => {
	result.fragment.querySelectorAll("for-each").forEach((component) => {
		(component as ForEachComponent).setBindings(result.bindings);
	});

	const elementsToBeUpdated = result.fragment.querySelectorAll(
		"[data-replace]:not(for-each *, for-each)"
	);

	elementsToBeUpdated.forEach((element) => {
		const binding =
			result.bindings[parseInt(element.getAttribute("data-replace") || "-1")];

		if (!binding) {
			return;
		}

		switch (binding.type) {
			case "ATTR":
				attributeRender(element, binding, activeValue);
				break;
			case "TEXT":
				textRender(element, binding, activeValue);
				break;
			case "TAG":
				tagRender(element, binding, activeValue);
				break;

			default:
				break;
		}
	});

	return result.fragment;
};

export const textRender = (
	element: Element,
	binding: TextBinding,
	activeValue = () => undefined
) => {
	const start = new Comment("start");
	const end = new Comment("end");
	element.replaceWith(start, end);

	createEffect(() => {
		const replacement = document.createTextNode(
			binding.value[0].toString() ?? ""
		);
		remove(start, end);
		start.after(replacement);
	});
};

export const tagRender = (
	element: Element,
	binding: TagBinding,
	activeValue = () => undefined
) => {
	createEffect(() => {
		const newTag = binding.value.join(""); //functions in here would need to get called

		const newElement = document.createElement(newTag);
		element
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, element.getAttribute(name)!)
			);

		newElement.replaceChildren(...element.childNodes);
		element.replaceWith(newElement);
	});
};

export const attributeRender = (
	element: Element,
	binding: AttrBinding,
	activeValue = () => undefined
) => {
	const attrPointer = new Comment("attr start above");
	element.append(attrPointer);

	console.log(binding);
	if (binding.value.length === 0 && binding.key.length === 1) {
		const soleValue = binding.key[0];
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
			const key = binding.key.join("");
			const value = binding.value.join("");

			attrPointer.parentElement!.setAttribute(key, value);
		});
	}
};
