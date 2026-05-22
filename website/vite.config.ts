import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

//inline plugin that prerenders the SSR demo at transform time
//we only process pages that contain the marker comment, so other pages stay untouched (and other tags like <nav-bar> aren't accidentally prerendered)
//we deliberately polyfill onto globalThis without setting `window` — the lib's `typeof window === "undefined"` check then flips on automatically
const ssrDemoPrerender = (): Plugin => {
	const marker = "<!--ssr-prerender:demo-loader-->";
	let happyDomReady = false;

	const setupHappyDom = async () => {
		if (happyDomReady) return;
		const { Window } = await import("happy-dom");
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
		await import("./src/components/ssr-demo-loader");
		happyDomReady = true;
	};

	return {
		name: "grundlage-ssr-demo-prerender",
		async transformIndexHtml(html) {
			if (!html.includes(marker)) return html;

			await setupHappyDom();

			//pull the original `<demo-loader ...>` tag right after the marker so we keep whatever attributes the page author wrote on it (label, delay, etc.)
			const tagMatch = html.match(
				new RegExp(`${marker}\\s*<demo-loader([^>]*)>\\s*</demo-loader>`),
			);
			if (!tagMatch) return html;
			const rawAttributes = tagMatch[1];

			const host = (
				globalThis as { document: Document }
			).document.createElement("demo-loader");
			rawAttributes
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.forEach((attribute) => {
					const [name, ...rest] = attribute.split("=");
					const value = rest.join("=").replace(/^"|"$/g, "");
					host.setAttribute(name, value ?? "");
				});
			(globalThis as { document: Document }).document.body.appendChild(host);

			//poll until the first-yield content lands — beats guessing a sleep duration for async-before-yield generators (matches the pattern in the SSR browser tests)
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				if (host.shadowRoot && host.shadowRoot.childNodes.length > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 16));
			}

			const hostAttributes = Array.from(host.attributes)
				.map((attribute) => ` ${attribute.name}="${attribute.value}"`)
				.join("");

			//happy-dom 20.x does not honour `serializableShadowRoots` in `getHTML`, so we hand-roll the declarative shadow DOM wrapper from the shadow root's innerHTML
			//the lib's defaults are open + clonable + delegatesFocus + serializable; we mirror those flags so the browser reconstructs the shadow with matching ownership semantics when it parses the page
			const shadowInnerHtml = host.shadowRoot?.innerHTML ?? "";
			const declarativeShadow = shadowInnerHtml
				? `<template shadowrootmode="open" shadowrootclonable shadowrootdelegatesfocus shadowrootserializable>${shadowInnerHtml}</template>`
				: "";
			host.remove();

			const replacement = `<demo-loader${hostAttributes}>${declarativeShadow}</demo-loader>`;
			console.log(replacement);
			return html.replace(tagMatch[0], `${marker}${replacement}`);
		},
	};
};

export default defineConfig({
	base: "/grundlage",
	server: { port: 8001, host: true },
	appType: "mpa",
	build: {
		rollupOptions: {
			input: {
				main: resolve(__dirname, "index.html"),
				async: resolve(__dirname, "pages/async/index.html"),
				animation: resolve(__dirname, "pages/animation/index.html"),
				animationList: resolve(__dirname, "pages/animation-list/index.html"),
				attributes: resolve(__dirname, "pages/attributes/index.html"),
				list: resolve(__dirname, "pages/list/index.html"),
				tags: resolve(__dirname, "pages/tags/index.html"),
				perf: resolve(__dirname, "pages/perf/index.html"),
				reorderStress: resolve(__dirname, "pages/reorder-stress/index.html"),
				mutationStress: resolve(__dirname, "pages/mutation-stress/index.html"),
				nested: resolve(__dirname, "pages/nesting/index.html"),
				krausest: resolve(__dirname, "pages/krausest/index.html"),
				ssrVsCsr: resolve(__dirname, "pages/ssr-vs-csr/index.html"),
			},
		},
	},
	plugins: [ssrDemoPrerender()],
});
