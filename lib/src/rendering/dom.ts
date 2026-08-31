import { BaseComponent } from "../types";

export const buildFragment = (markup: string): DocumentFragment => {
	const parserHost = document.createElement("template");
	parserHost.innerHTML = markup;
	return parserHost.content;
};

//duck-typed user surface: any custom element exposing update() opts into a property-set re-render
export const triggerComponentUpdate = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};
