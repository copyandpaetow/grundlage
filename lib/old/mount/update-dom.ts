import type { Context } from "../context";
import { mount, type TemplateBus } from "./mount";
import { mountList } from "./mount-list";
import { updateContent } from "./update-content";
import { updateStyle } from "./update-style";
import { updateAttributes } from "./update-attributes";

const wrapInTemplate = (element: Element): HTMLTemplateElement => {
	if (element instanceof HTMLTemplateElement) {
		return element;
	}

	const template = document.createElement("template");

	element.replaceWith(template);
	template.content.append(element);

	return template;
};

export const updateDOM = (
	content: DocumentFragment,
	templateBus: TemplateBus,
	context: Context
) => {
	content.querySelectorAll("[slot='item']").forEach((element) => {
		element.removeAttribute("slot");
		mountList(wrapInTemplate(element), templateBus, context);
	});

	content.querySelectorAll("template").forEach((templateElement) => {
		mount(templateElement, templateBus, context);
	});

	(
		content.querySelectorAll("[data-update]") as NodeListOf<HTMLElement>
	).forEach((stubbedElement) => {
		updateAttributes(stubbedElement, templateBus, context);
	});

	content
		.querySelectorAll("[data-replace]")
		.forEach((stubbedElement) =>
			updateContent(stubbedElement, templateBus, context)
		);

	content
		.querySelectorAll("style")
		.forEach((styleElement) => updateStyle(styleElement, context));

	return content;
};
