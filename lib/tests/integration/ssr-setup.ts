import { Window } from "happy-dom";

//side-effect-only: applies happy-dom globals to globalThis before any importer touches `document`
//`window` is deliberately NOT assigned — `typeof window === "undefined"` is the lib's server signal and must stay true

const happyWindow = new Window();

Object.assign(globalThis, {
	document: happyWindow.document,
	customElements: happyWindow.customElements,
	HTMLElement: happyWindow.HTMLElement,
	HTMLTemplateElement: happyWindow.HTMLTemplateElement,
	Comment: happyWindow.Comment,
	DocumentFragment: happyWindow.DocumentFragment,
	Element: happyWindow.Element,
	Range: happyWindow.Range,
	NodeFilter: happyWindow.NodeFilter,
	MutationObserver: happyWindow.MutationObserver,
	CSSStyleSheet: happyWindow.CSSStyleSheet,
});
