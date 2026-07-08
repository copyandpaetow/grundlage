import { BaseComponent } from "../types";

const parserHost = document.createElement("template");

export const buildFragment = (result: string): DocumentFragment => {
	parserHost.innerHTML = result;
	const fragment = document.createDocumentFragment();
	while (parserHost.content.firstChild) {
		fragment.append(parserHost.content.firstChild);
	}
	return fragment;
};

export const targetElement = (liveBinding: {
	hostElement: Element | null;
	markerComment: Comment | null;
}): Element =>
	liveBinding.hostElement ?? liveBinding.markerComment!.nextElementSibling!;

export const nudgeComponent = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};
