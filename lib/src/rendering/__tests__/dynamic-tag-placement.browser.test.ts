import { describe, expect, test } from "vitest";
import { html, component, ComponentErrorEvent } from "../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("dynamic tag placement", () => {
	let tagId = 0;
	const uniqueTag = () => `test-tag-placement-${tagId++}-${Date.now()}`;

	const mountWithErrorCapture = async (renderTemplate: () => unknown) => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(function* () {
				yield renderTemplate;
			}),
		);
		const element = document.createElement(tag);
		const errors: Array<unknown> = [];
		element.addEventListener("grundlage-error", (event) => {
			errors.push((event as ComponentErrorEvent).error);
			event.preventDefault();
		});
		document.body.appendChild(element);
		await sleep();
		element.remove();
		return { shadowMarkup: element.shadowRoot?.innerHTML ?? "", errors };
	};

	test("an inline dynamic tag inside <p> keeps the paragraph open", async () => {
		const tag = "span";
		const { shadowMarkup, errors } = await mountWithErrorCapture(
			() => html`<p>before<${tag}>inline</${tag}>after</p>`,
		);

		expect(errors).toEqual([]);
		expect(shadowMarkup.replace(/<!--[\s\S]*?-->/g, "")).toBe(
			"<p>before<span>inline</span>after</p>",
		);
	});

	test("a dynamic tag the parser relocates out of a table ends the component with a remedy", async () => {
		const tag = "tr";
		const { shadowMarkup, errors } = await mountWithErrorCapture(
			() => html`<table><tbody><${tag}><td>1</td></${tag}></tbody></table>`,
		);

		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(
			/inside <tbody> was moved by the HTML parser/,
		);
		expect(shadowMarkup).not.toContain("<table>");
	});

	test("a dynamic tag in a position the parser accepts renders", async () => {
		const tag = "li";
		const { shadowMarkup, errors } = await mountWithErrorCapture(
			() => html`<ul><${tag}>a</${tag}></ul>`,
		);

		expect(errors).toEqual([]);
		expect(shadowMarkup.replace(/<!--[\s\S]*?-->/g, "")).toBe(
			"<ul><li>a</li></ul>",
		);
	});
});
