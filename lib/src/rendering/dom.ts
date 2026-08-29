import { BaseComponent } from "../types";

//lazy platform singleton: one detached <template> reused to parse every fragment
let parserHost: HTMLTemplateElement | null = null;

export const buildFragment = (result: string): DocumentFragment => {
	parserHost ??= document.createElement("template");
	parserHost.innerHTML = result;
	const fragment = document.createDocumentFragment();
	while (parserHost.content.firstChild) {
		fragment.appendChild(parserHost.content.firstChild);
	}
	return fragment;
};

//duck-typed user surface: any custom element exposing update() opts into a property-set re-render
export const triggerComponentUpdate = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};
