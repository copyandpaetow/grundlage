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



*/

export const remove = (start: Node, end: Node): DocumentFragment => {
	const deletedContent = new DocumentFragment();

	let current = start.nextSibling;
	while (current && current !== end) {
		const next = current.nextSibling;
		deletedContent.append(current);
		current = next;
	}

	return deletedContent;
};

export const updateDynamicParts = (
	fragment: Result["fragment"],
	bindings: Result["bindings"],
	activeValue = () => undefined
) => {
	fragment.querySelectorAll("for-each").forEach((component) => {
		(component as ForEachComponent).setBindings(bindings);
	});

	fragment
		.querySelectorAll("[data-text-replace]:not(for-each *, for-each)")
		.forEach((replacementElement) => {
			const binding =
				bindings[
					parseInt(replacementElement.getAttribute("data-text-replace") || "-1")
				];
			textRender(replacementElement, binding, activeValue);
		});

	fragment
		.querySelectorAll("[data-tag-replace]:not(for-each *, for-each)")
		.forEach((replacementElement) => {
			const binding =
				bindings[
					parseInt(replacementElement.getAttribute("data-tag-replace") || "-1")
				];
			replacementElement.removeAttribute("data-tag-replace");
			tagRender(replacementElement, binding, activeValue);
		});

	fragment
		.querySelectorAll("[data-attr-replace]:not(for-each *, for-each)")
		.forEach((replacementElement) => {
			replacementElement.getAttributeNames().forEach((attrName) => {
				if (!attrName.includes("data-attr-replace-")) {
					return;
				}

				const binding =
					bindings[parseInt(replacementElement.getAttribute(attrName) || "-1")];
				attributeRender(replacementElement, binding, activeValue);
				replacementElement.removeAttribute(attrName);
			});
			replacementElement.removeAttribute("data-attr-replace");
		});

	return fragment;
};

const unpack = (value: unknown, activeValue: () => unknown) => {
	if (typeof value === "function") {
		return value(activeValue());
	}

	return value.toString();
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
			unpack(binding.value[0], activeValue)
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
				soleValue.forEach((key) => {
					createEffect(() => {
						attrPointer.parentElement!.setAttribute(key, "");
					});
				});
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
