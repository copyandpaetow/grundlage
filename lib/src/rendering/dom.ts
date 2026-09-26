import { BaseComponent } from "../types";

export const buildFragment = (markup: string): DocumentFragment => {
	const parserHost = document.createElement("template");
	parserHost.innerHTML = markup;
	return parserHost.content;
};

//a closed shadow root is absent from host.shadowRoot; internals is its only handle
export const resolveShadowRoot = (host: Element): ShadowRoot | null =>
	host.shadowRoot ?? (host as BaseComponent).internals?.shadowRoot ?? null;

//duck-typed user surface: any custom element exposing update() opts into a property-set re-render
export const triggerComponentUpdate = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};
