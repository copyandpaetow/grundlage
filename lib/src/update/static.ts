import { TemplateResult } from "../html/html";

export const renderStaticDom = (result: TemplateResult) => {
	const fragment = result.fragment.cloneNode(true) as DocumentFragment; //the fragment is being lazily cloned so we need to do that here once

	result.contentBinding.forEach((contentIndex, index) => {
		const placeholder = fragment.querySelector(
			`[data-content-replace-${index}]`
		)!;
		const text = result.dynamicValues[contentIndex];
		let textNode = document.createTextNode(text);
		placeholder.replaceWith(textNode);
	});

	result.tagBinding.forEach((tagContent, index) => {
		const placeholder = fragment.querySelector(`[data-tag-replace-${index}]`)!;
		placeholder?.removeAttribute(`data-tag-replace-${index}`);

		const newTag = tagContent.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? result.dynamicValues[relatedIndex]
					: relatedIndex
			)
			.join(""); //functions in here would need to get called

		const newElement = document.createElement(newTag);
		placeholder
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, placeholder.getAttribute(name)!)
			);

		newElement.replaceChildren(...placeholder.childNodes);
		placeholder.replaceWith(newElement);
	});

	result.attrBinding.forEach((tagContent, index) => {
		const placeholder = fragment.querySelector(`[data-attr-replace-${index}]`)!;
		placeholder?.removeAttribute(`data-attr-replace-${index}`);

		const key = tagContent.keys
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? result.dynamicValues[relatedIndex]
					: relatedIndex
			)
			.join("");
		const value = tagContent.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? result.dynamicValues[relatedIndex]
					: relatedIndex
			)
			.join("");

		placeholder.setAttribute(key, value);
	});

	return fragment;
};
