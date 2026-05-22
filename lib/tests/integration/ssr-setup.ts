import { Window } from "happy-dom";

//side-effect-only module: applies happy-dom DOM globals to `globalThis` before any importer touches `document`
//mirrors prerender-plugin/ssr-render.ts so the SSR tests run against the same surface the plugin produces in real builds
//crucially, `window` is NOT assigned — the lib uses `typeof window === "undefined"` as the server signal, and we want that to stay true here

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
