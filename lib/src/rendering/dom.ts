import { BaseComponent } from "../types";
import { assertDuringDevelopment } from "../utils/diagnostics";
import { DECLARED_PROP_NAMES } from "./constants";
import {
	ParseContextKind,
	WRAPPER_TAG_BY_PARSE_CONTEXT,
} from "./parse-context";
import * as PARSE_CONTEXT from "./parse-context-kind";

//missing from TypeScript's DOM types; createHTML is typed as the string innerHTML takes
interface MarkupPolicy {
	createHTML: (markup: string) => string;
}

interface TrustedTypePolicyFactory {
	createPolicy: (name: string, rules: MarkupPolicy) => MarkupPolicy;
}

//a page creates a policy name once, unless its CSP allows duplicates
let markupPolicy: MarkupPolicy | null = null;

//the markup comes from template literals in source and never holds a value, so the policy passes
//it through; a page that enforces Trusted Types refuses a plain string
const trustedMarkupOf = (markup: string): string => {
	const factory = (globalThis as { trustedTypes?: TrustedTypePolicyFactory })
		.trustedTypes;
	if (factory === undefined) return markup;
	markupPolicy ??= factory.createPolicy("grundlage", {
		createHTML: (text) => text,
	});
	return markupPolicy.createHTML(markup);
};

//markup parsed on its own is HTML; inside <svg> or <math> the parser switches namespace, so a
//template headed there is parsed inside a wrapper of that element and unwrapped
export const buildFragment = (
	markup: string,
	parseContext: ParseContextKind = PARSE_CONTEXT.HTML,
): DocumentFragment => {
	const parserHost = document.createElement("template");
	if (parseContext === PARSE_CONTEXT.HTML) {
		parserHost.innerHTML = trustedMarkupOf(markup);
		return parserHost.content;
	}
	const wrapperTag = WRAPPER_TAG_BY_PARSE_CONTEXT[parseContext];
	parserHost.innerHTML = trustedMarkupOf(
		`<${wrapperTag}>${markup}</${wrapperTag}>`,
	);
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

const isComponent = (element: Element): element is BaseComponent =>
	DECLARED_PROP_NAMES in element.constructor;

//a component of this library only: another library's update() has its own contract, and Lit's is
//its render step, which throws before the element is connected and skips updated() after
export const triggerComponentUpdate = (element: Element): void => {
	if (isComponent(element)) element.update();
};
