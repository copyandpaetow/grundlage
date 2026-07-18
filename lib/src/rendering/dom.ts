import { BaseComponent } from "../types";

let parserHost: HTMLTemplateElement | null = null;

export const buildFragment = (result: string): DocumentFragment => {
	parserHost ??= document.createElement("template");
	parserHost.innerHTML = result;
	const fragment = document.createDocumentFragment();
	while (parserHost.content.firstChild) {
		fragment.append(parserHost.content.firstChild);
	}
	return fragment;
};

// Re-read the sibling each commit: swapElement's replaceWith invalidates any cached element.
export const targetElement = (liveBinding: { anchor: Comment | Element }): Element =>
	liveBinding.anchor instanceof Comment
		? liveBinding.anchor.nextElementSibling!
		: liveBinding.anchor;

// Duck-typed user surface: any custom element exposing update() opts into a property-set re-render.
export const nudgeComponent = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};
