import { expect, test } from "vitest";
import { component, html } from "../index";
import { BaseComponent } from "../types";

const hasTrustedTypes = typeof (globalThis as { trustedTypes?: unknown }).trustedTypes === "object";

//the policy stays in this file's page, so every test here runs under it
const enforceTrustedTypes = () => {
	const policy = document.createElement("meta");
	policy.httpEquiv = "Content-Security-Policy";
	policy.content = "require-trusted-types-for 'script'; trusted-types grundlage";
	document.head.append(policy);
};

test.runIf(hasTrustedTypes)(
	"a component paints under an enforced Trusted Types policy",
	async () => {
		enforceTrustedTypes();
		expect(() => {
			document.createElement("div").innerHTML = "<b>x</b>";
		}).toThrow(TypeError);
		customElements.define(
			"trusted-types-paint",
			component(function* () {
				//a template inside <svg> is parsed in a wrapper, the second markup write
				yield html`<p>${"hello"}</p>
					<svg>${html`<circle r=${1}></circle>`}</svg>
					<template><b>${"stamp"}</b></template>`;
			}),
		);
		const host = document.createElement("trusted-types-paint") as BaseComponent;
		document.body.append(host);
		await host.update();
		expect(host.shadowRoot!.querySelector("p")!.textContent).toBe("hello");
		expect(host.shadowRoot!.querySelector("circle")!.getAttribute("r")).toBe("1");
		expect(host.shadowRoot!.querySelector("template")!.content.textContent).toBe("stamp");
		host.remove();
	},
);
