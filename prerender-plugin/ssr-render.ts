import type { Window as HappyWindow } from "happy-dom";

//one-time happy-dom polyfill onto globalThis; `window` is deliberately not assigned so `typeof window === "undefined"` stays true
//we cache the promise (not a bool) so concurrent first calls all wait on the same import
let setupPromise: Promise<void> | null = null;

const setupHappyDom = (
	componentLoaders: ReadonlyArray<() => Promise<unknown>>,
): Promise<void> => {
	if (setupPromise) return setupPromise;
	setupPromise = (async () => {
		const { Window } = await import("happy-dom");
		const happyWindow: HappyWindow = new Window();
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
		await Promise.all(componentLoaders.map((load) => load()));
	})();
	return setupPromise;
};

const parseAttributes = (rawAttributes: string): Array<[string, string]> => {
	const pairs: Array<[string, string]> = [];
	const pattern = /([^\s=]+)(?:="([^"]*)")?/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(rawAttributes)) !== null) {
		pairs.push([match[1], match[2] ?? ""]);
	}
	return pairs;
};

/**
 * Mounts the host under happy-dom, waits for first-yield content, returns
 * serialized declarative-shadow-DOM HTML.
 *
 * Serializes via `document.body.getHTML(...)` because happy-dom's
 * `Element.getHTML` only walks children — the `<template>` wrapper is
 * emitted in the parent's ELEMENT_NODE branch.
 */
export const renderHost = async (
	tagName: string,
	rawAttributes: string,
	componentLoaders: ReadonlyArray<() => Promise<unknown>>,
	pollTimeoutMs = 5000,
): Promise<string> => {
	await setupHappyDom(componentLoaders);

	const documentRef = (globalThis as { document: Document }).document;
	const host = documentRef.createElement(tagName);
	for (const [name, value] of parseAttributes(rawAttributes)) {
		host.setAttribute(name, value);
	}
	documentRef.body.appendChild(host);

	//poll rather than sleep — async-before-yield settle times are workload-dependent
	const deadline = Date.now() + pollTimeoutMs;
	while (Date.now() < deadline) {
		if (host.shadowRoot && host.shadowRoot.childNodes.length > 0) break;
		await new Promise((resolve) => setTimeout(resolve, 16));
	}

	const serialized = (
		documentRef.body as unknown as {
			getHTML(options: { serializableShadowRoots: boolean }): string;
		}
	).getHTML({ serializableShadowRoots: true });

	host.remove();
	return serialized;
};
