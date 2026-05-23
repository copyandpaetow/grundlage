import type { Window as HappyWindow } from "happy-dom";

//one-time happy-dom polyfill onto globalThis; window is deliberately not assigned so the lib's `typeof window === "undefined"` server check stays true
//we cache the promise (not a bool) so concurrent first calls during a build all wait on the same import
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
 * Mounts `<tagName ...rawAttributes></tagName>` under the polyfilled document,
 * waits for the first-yield shadow content, and returns the host's serialized
 * outer HTML (with declarative shadow DOM `<template>` carrying whatever
 * `attachShadow` flags the component used).
 *
 * Serialization goes through `document.body.getHTML(...)` because happy-dom's
 * `Element.getHTML` only walks child nodes — the shadow-root `<template>`
 * wrapper is emitted in the parent's ELEMENT_NODE branch of the serializer.
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

	//poll for first-yield content; async-before-yield generators settle on their own await chain, so a fixed sleep would either over- or under-wait
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
