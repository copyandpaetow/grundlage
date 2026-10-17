import { BaseComponent } from "../types";
import { assertDuringDevelopment } from "../utils/diagnostics";
import {
	PARSE_CONTEXT,
	ParseContextKind,
	WRAPPER_TAG_BY_PARSE_CONTEXT,
} from "./parse-context";

//markup parsed on its own is HTML; inside <svg> or <math> the parser switches namespace, so a
//template headed there is parsed inside a wrapper of that element and unwrapped
export const buildFragment = (
	markup: string,
	parseContext: ParseContextKind = PARSE_CONTEXT.HTML,
): DocumentFragment => {
	const parserHost = document.createElement("template");
	if (parseContext === PARSE_CONTEXT.HTML) {
		parserHost.innerHTML = markup;
		return parserHost.content;
	}
	const wrapperTag = WRAPPER_TAG_BY_PARSE_CONTEXT[parseContext];
	parserHost.innerHTML = `<${wrapperTag}>${markup}</${wrapperTag}>`;
	const fragment = parserHost.content;
	const wrapper = fragment.firstChild;
	assertDuringDevelopment(
		wrapper !== null,
		"the parse wrapper is the first node of its own markup",
	);
	fragment.replaceChildren(...wrapper.childNodes);
	return fragment;
};

//a closed shadow root is absent from host.shadowRoot; internals is its only handle
export const findShadowRoot = (host: Element): ShadowRoot | null =>
	host.shadowRoot ?? (host as BaseComponent).internals?.shadowRoot ?? null;

//duck-typed user surface: any custom element exposing update() opts into a property-set update
export const triggerComponentUpdate = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};
