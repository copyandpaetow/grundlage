import { describe, expect, test } from "vitest";
import { html } from "../parser/html";
import { BINDING_TYPES } from "../parser/types";
import { HTMLTemplate } from "./template-html";

describe("HTMLTemplate.hash — cache invalidation", () => {
	//the renderer relies on `hash` being lazy (only computed when read) and invalidated on update()
	//if we forgot to clear #hash, list diffing would compare against the prior frame and reuse the wrong template
	//update() touches dirtyBindings, which is only allocated by setup() — so every test that calls update() needs setup() first, mirroring the production path
	test("returns a new value after update() with different expressions", () => {
		const template = html`<p>${"a"}</p>`;
		template.setup(null);
		const firstHash = template.hash;
		template.update(["b"]);
		expect(template.hash).not.toBe(firstHash);
	});

	test("matches a freshly built template carrying the same updated expressions", () => {
		//we update one template in place and compare its hash against a fresh template parsed from the SAME tagged-template literal site with the same values
		//=> if the cache invalidation is correct, the two hashes must agree (template shape × expression fold is identical)
		//the helper exists so both `html` calls reach the parser cache via the same TemplateStringsArray identity — calling html`...` at two different source positions would parse to two different ParsedHTML with different templateHash and break the comparison
		const makeParagraph = (value: string) => html`<p>${value}</p>`;
		const template = makeParagraph("a");
		template.setup(null);
		template.update(["b"]);
		const freshTemplate = makeParagraph("b");
		expect(template.hash).toBe(freshTemplate.hash);
	});

	test("is stable across reads between updates", () => {
		const template = html`<p>${"a"}</p>`;
		const first = template.hash;
		const second = template.hash;
		expect(second).toBe(first);
	});
});

describe("HTMLTemplate.update — previousExpressions reset", () => {
	//the comment on template-html.ts:30 promises previousExpressions is dropped after #flush so the prior frame's values (possibly large objects) can be collected
	//=> we pin that invariant here so a future refactor can't accidentally retain a reference and leak between renders
	test("drops previousExpressions to a zero-length array after update()", () => {
		const template = html`<p>${"a"}</p>`;
		template.setup(null);
		template.update(["b"]);
		expect(template.previousExpressions.length).toBe(0);
	});

	test("repeated updates do not accumulate previousExpressions", () => {
		const template = html`<p>${"a"}</p>`;
		template.setup(null);
		template.update(["b"]);
		template.update(["c"]);
		template.update(["d"]);
		expect(template.previousExpressions.length).toBe(0);
	});
});

describe("HTMLTemplate.setup — host binding requirement", () => {
	//findTargets fails fast when a root-template carries host bindings but no host is supplied
	//without this check the host slot would be filled with `undefined` and crash later in updateAttribute on a missing element
	test("throws a descriptive error when a root template needs a host but none is provided", () => {
		const template = html`<template id="${"missing-host"}"
			><p>hi</p></template
		>`;
		expect(template.parsedHTML.hostBindingOffset).toBeGreaterThan(0);
		expect(() => template.setup(null)).toThrow(
			/top level of a component's render output/,
		);
	});

	test("does not throw for a template without host bindings even when host is null", () => {
		const template = html`<p>${"x"}</p>`;
		expect(template.parsedHTML.hostBindingOffset).toBe(0);
		expect(() => template.setup(null)).not.toThrow();
	});

	test("rejects a root template that is interpolated into a parent's content", () => {
		//the parent renders fine on its own, but the nested root template has host bindings
		//and content.ts calls setup(null) so findTargets has to throw
		const inner = html`<template class="leak"><p>x</p></template>`;
		expect(inner.parsedHTML.hostBindingOffset).toBeGreaterThan(0);

		const host = document.createElement("div");
		host.attachShadow({ mode: "open" });
		const outer = html`<div>${inner}</div>`;
		expect(() => outer.setup(host as any)).toThrow(
			/top level of a component's render output/,
		);
	});

	test("rejects a root template that appears as a list item", () => {
		const items = [html`<template class="leak"><p>x</p></template>`];
		const host = document.createElement("div");
		host.attachShadow({ mode: "open" });
		const outer = html`<ul>${items}</ul>`;
		expect(() => outer.setup(host as any)).toThrow(
			/top level of a component's render output/,
		);
	});
});

describe("HTMLTemplate.setup — fragment + target wiring", () => {
	test("produces a DocumentFragment with the parsed shape", () => {
		const template = html`<section><p>${"hi"}</p></section>`;
		const fragment = template.setup(null);
		expect(fragment.querySelector("section")).not.toBeNull();
		expect(fragment.querySelector("p")?.textContent).toContain("hi");
	});

	test("targets array length matches the bindings array length", () => {
		const template = html`<p class="${"c"}">${"text"}</p>`;
		template.setup(null);
		expect(template.targets.length).toBe(template.parsedHTML.bindings.length);
	});

	test("dirtyBindings is allocated to the binding count", () => {
		const template = html`<p class="${"c"}">${"text"}</p>`;
		template.setup(null);
		expect(template.dirtyBindings.length).toBe(
			template.parsedHTML.bindings.length,
		);
	});
});

describe("HTMLTemplate.hydrate — re-applies only ATTR bindings", () => {
	//hydrate is run on the live shadow DOM that SSR already wrote — child elements and their static attrs are there, but host attrs only exist as bindings
	//=> only ATTR bindings re-run (template-html.ts:77-83). Content stays put so we don't double-write the server text. We pin both halves here.

	//we use setup() to lay down real binding markers in a host's shadow root, then we run hydrate() on a fresh template with different expressions
	//=> the test exercises the actual parser-produced marker shape and does not depend on internal comment-data formatting
	const buildHydratedHost = (
		serverTemplate: HTMLTemplate,
	): { host: HTMLElement; shadowRoot: ShadowRoot } => {
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		shadowRoot.appendChild(serverTemplate.setup(null));
		return { host, shadowRoot };
	};

	const hydrateAs = (template: HTMLTemplate, host: HTMLElement) => {
		//hydrate's signature requires a BaseComponent — it only reads host.shadowRoot, so a cast is enough for this unit test
		template.hydrate(host as unknown as Parameters<typeof template.hydrate>[0]);
	};

	test("ATTR binding on a child element is re-applied on hydrate", () => {
		const serverTemplate = html`<div>
			<span class="${"server-class"}"></span>
		</div>`;
		const { host, shadowRoot } = buildHydratedHost(serverTemplate);
		expect(shadowRoot.querySelector("span")?.getAttribute("class")).toBe(
			"server-class",
		);

		//we mutate the live attribute to a sentinel so we can prove hydrate overwrote it (rather than the prior value happening to match the new expression)
		shadowRoot.querySelector("span")!.setAttribute("class", "stale-from-dom");

		const clientTemplate = html`<div>
			<span class="${"client-class"}"></span>
		</div>`;
		hydrateAs(clientTemplate, host);

		expect(shadowRoot.querySelector("span")?.getAttribute("class")).toBe(
			"client-class",
		);
	});

	test("CONTENT binding is NOT re-written by hydrate", () => {
		//if a future change accidentally re-runs CONTENT bindings on hydrate, the server-rendered DOM gets replaced and we lose the no-flash contract
		const serverTemplate = html`<p>${"server-text"}</p>`;
		const { host, shadowRoot } = buildHydratedHost(serverTemplate);
		const paragraph = shadowRoot.querySelector("p")!;
		const serverTextNode = Array.from(paragraph.childNodes).find(
			(node) => node.nodeType === Node.TEXT_NODE,
		) as Text;
		expect(serverTextNode?.data).toBe("server-text");

		const clientTemplate = html`<p>${"client-text"}</p>`;
		hydrateAs(clientTemplate, host);

		//same text node identity, same data — CONTENT was skipped
		const paragraphAfter = shadowRoot.querySelector("p")!;
		const textAfter = Array.from(paragraphAfter.childNodes).find(
			(node) => node.nodeType === Node.TEXT_NODE,
		) as Text;
		expect(textAfter).toBe(serverTextNode);
		expect(textAfter.data).toBe("server-text");
	});

	test("a subsequent update() after hydrate refreshes the CONTENT binding", () => {
		//locks down the post-hydrate flow: hydrate trusts the server, update() then catches the DOM up to current expressions
		const serverTemplate = html`<p>${"server-text"}</p>`;
		const { host, shadowRoot } = buildHydratedHost(serverTemplate);

		const clientTemplate = html`<p>${"client-text"}</p>`;
		hydrateAs(clientTemplate, host);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("server-text");

		clientTemplate.update(["refreshed"]);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("refreshed");
	});
});

describe("HTMLTemplate.update — dirty-binding bookkeeping", () => {
	//we read dirtyBindings right after setup to confirm flush cleared every slot
	//then we update with the same primitive values and assert the bookkeeping array stays clear (no spurious dirty marks for unchanged primitives)
	test("after setup() every dirty bit is cleared", () => {
		const template = html`<div class="${"x"}">${"y"}</div>`;
		template.setup(null);
		for (let index = 0; index < template.dirtyBindings.length; index++) {
			expect(template.dirtyBindings[index]).toBe(0);
		}
	});

	test("update with identical primitives leaves every dirty bit clear after flush", () => {
		const template = html`<div class="${"x"}">${"y"}</div>`;
		template.setup(null);
		template.update(["x", "y"]);
		for (let index = 0; index < template.dirtyBindings.length; index++) {
			expect(template.dirtyBindings[index]).toBe(0);
		}
	});

	test("update with a changed primitive flushes the corresponding binding", () => {
		//we observe the side effect (DOM mutated) rather than reading dirtyBindings mid-flight, since #flush clears the bits as it goes
		const template = html`<p class="${"before"}">${"hi"}</p>`;
		const fragment = template.setup(null);
		const paragraph = fragment.querySelector("p")!;
		expect(paragraph.getAttribute("class")).toBe("before");

		template.update(["after", "hi"]);
		expect(paragraph.getAttribute("class")).toBe("after");
	});
});

describe("HTMLTemplate constructor — initial state", () => {
	test("captures the parsed template and current expressions", () => {
		const template = html`<p>${"a"}</p>`;
		expect(template.currentExpressions).toEqual(["a"]);
		expect(template.parsedHTML.bindings.length).toBeGreaterThan(0);
	});

	test("starts with previousExpressions empty so the first flush sees no prior frame", () => {
		const template = html`<p>${"a"}</p>`;
		expect(template.previousExpressions.length).toBe(0);
	});

	test("parsed bindings include a CONTENT entry for a text expression", () => {
		const template = html`<p>${"a"}</p>`;
		const hasContentBinding = template.parsedHTML.bindings.some(
			(binding) => binding.type === BINDING_TYPES.CONTENT,
		);
		expect(hasContentBinding).toBe(true);
	});
});
