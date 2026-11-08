import { describe, expect, test } from "vitest";
import { component, html } from "../index";
import { BaseComponent } from "../types";

let tagIndex = 0;

//the update generator catches and paints nothing, so the template that threw stays in place
const paintAll = async (paints: Array<() => unknown>) => {
	const tag = `injection-${tagIndex++}`;
	const errors: Array<unknown> = [];
	let paintIndex = 0;
	customElements.define(
		tag,
		component(function* () {
			yield function* view() {
				try {
					yield paints[paintIndex]() as ReturnType<typeof html>;
				} catch (error) {
					errors.push(error);
				}
			};
		}),
	);
	const host = document.createElement(tag) as BaseComponent;
	document.body.append(host);
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (paintIndex = 1; paintIndex < paints.length; paintIndex++) await host.update();
	const shadowRoot = host.shadowRoot!;
	host.remove();
	return { errors, shadowRoot };
};

describe("a value that would end its element in server markup throws", () => {
	test.each([
		["</style", "</style><img src=x onerror=alert(1)>"],
		["</STYLE", "</STYLE><img src=x onerror=alert(1)>"],
	])("%s in a <style> hole throws", async (_, value) => {
		const { errors } = await paintAll([
			() =>
				html`<style>
					p {
						content: "${value}";
					}
				</style>`,
		]);
		expect(String(errors[0])).toMatch(/grundlage: <style> .*"<\/style"/);
	});

	test("a `<` in the template and `/style` in the value throw together", async () => {
		const { errors } = await paintAll([
			() =>
				html`<style>
					p {
						content: "<${"/style>"}";
					}
				</style>`,
		]);
		expect(String(errors[0])).toMatch(/grundlage: <style> .*"<\/style"/);
	});

	//a quoted string is a value the CSSOM accepts, so the update lane cannot drop it on its own
	test("an update to a value with </style throws and leaves the sheet as it was", async () => {
		const paint = (text: string) =>
			html`<style>
				p {
					content: ${text};
				}
			</style>`;
		const { errors, shadowRoot } = await paintAll([
			() => paint('"a"'),
			() => paint('"</style><img src=x onerror=alert(1)>"'),
		]);
		expect(String(errors[0])).toMatch(/grundlage: <style> .*"<\/style"/);
		const style = shadowRoot.querySelector("style")!;
		expect(style.textContent).toContain('content: "a";');
		expect(style.textContent).not.toContain("</style");
		const rule = style.sheet?.cssRules[0] as CSSStyleRule | undefined;
		if (rule !== undefined) expect(rule.style.content).toBe('"a"');
	});

	//a mount that throws keeps no instance, so the repeat has to be a patch
	test.each([
		[
			"<style>",
			(text: string) =>
				html`<style>
					p {
						content: "${text}";
					}
				</style>`,
		],
		[
			"comment",
			(text: string) =>
				html`<!--${"key"}-->
					<div><!--${text}--></div>`,
		],
	])("the same value painted again in a %s throws again", async (_, paint) => {
		const { errors } = await paintAll([
			() => paint("a"),
			() => paint("</style>-->"),
			() => paint("</style>-->"),
		]);
		expect(errors).toHaveLength(2);
	});

	test.each([
		["</script", JSON.stringify({ note: "</script><img src=x onerror=alert(1)>" })],
		["</SCRIPT", JSON.stringify({ note: "</SCRIPT><img src=x onerror=alert(1)>" })],
		["<!--", JSON.stringify({ note: "<!--<script>" })],
	])("%s in a <script> hole throws", async (_, value) => {
		const { errors } = await paintAll([
			() =>
				html`<script type="application/json">
					${value}
				</script>`,
		]);
		expect(String(errors[0])).toMatch(/grundlage: <script> .*\\u003c/);
	});

	test("a <script> value with every `<` written as \\u003c paints", async () => {
		const value = JSON.stringify({ note: "</script><!--" }).replaceAll("<", "\\u003c");
		const { errors, shadowRoot } = await paintAll([
			() =>
				html`<script type="application/json">
					${value}
				</script>`,
		]);
		expect(errors).toEqual([]);
		expect(shadowRoot.querySelector("script")!.textContent.trim()).toBe(value);
	});

	//the first dynamic comment is the key and never reaches the DOM
	test.each([
		["-->", "--><img src=x onerror=alert(1)><!--"],
		["--!>", "--!><img src=x onerror=alert(1)><!--"],
		["a leading >", "><img src=x onerror=alert(1)>"],
		["a leading ->", "-><img src=x onerror=alert(1)>"],
	])("%s in a comment hole throws", async (_, value) => {
		const { errors } = await paintAll([
			() =>
				html`<!--${"key"}-->
					<div><!--${value}--></div>`,
		]);
		expect(String(errors[0])).toMatch(/grundlage: a comment .*"-->"/);
	});

	test("a comment with `--` and `>` inside paints", async () => {
		const { errors, shadowRoot } = await paintAll([
			() =>
				html`<!--${"key"}-->
					<div><!--${"a -- b > c -"}--></div>`,
		]);
		expect(errors).toEqual([]);
		const comment = shadowRoot.querySelector("div")!.lastChild as Comment;
		expect(comment.data).toBe("a -- b > c -");
	});
});

describe("a hole inside an element whose text is written unescaped throws", () => {
	test.each([
		[
			"<noscript>",
			() =>
				html`<div>
					<noscript>${"</noscript><img src=x onerror=alert(1)>"}</noscript>
				</div>`,
		],
		["<xmp>", () => html`<div><xmp>${"</xmp><img src=x onerror=alert(1)>"}</xmp></div>`],
		[
			"<iframe>",
			() =>
				html`<div>
					<iframe>${"</iframe><img src=x onerror=alert(1)>"}</iframe>
				</div>`,
		],
		[
			"<noembed>",
			() =>
				html`<div>
					<noembed>${"</noembed><img src=x onerror=alert(1)>"}</noembed>
				</div>`,
		],
		[
			"<noframes>",
			() =>
				html`<div>
					<noframes>${"</noframes><img src=x onerror=alert(1)>"}</noframes>
				</div>`,
		],
		["<plaintext>", () => html`<div><plaintext>${"text"}</plaintext></div>`],
	])("a hole in %s throws", async (tag, paint) => {
		const { errors } = await paintAll([paint]);
		expect(String(errors[0])).toContain(`grundlage: ${tag} expects no \${…}`);
	});

	test("an attribute hole on an element inside <noscript> throws", async () => {
		const { errors } = await paintAll([
			() => html`<noscript><a href=${"/fallback"}>Open the fallback</a></noscript>`,
		]);
		expect(String(errors[0])).toContain("grundlage: <noscript> expects no ${…}");
	});

	test("a hole in an uppercase <NOSCRIPT> throws", async () => {
		//prettier-ignore
		const { errors } = await paintAll([() => html`<NOSCRIPT>${"</NOSCRIPT><img src=x onerror=alert(1)>"}</NOSCRIPT>`]);
		expect(String(errors[0])).toContain("grundlage: <NOSCRIPT> expects no ${…}");
	});

	test("a hole in a later <noscript> throws", async () => {
		const { errors } = await paintAll([
			() =>
				html`<noscript>static</noscript>
					<noscript>${"</noscript><img src=x onerror=alert(1)>"}</noscript>`,
		]);
		expect(String(errors[0])).toContain("grundlage: <noscript> expects no ${…}");
	});

	test("a hole after a tag that only starts like </noscript throws", async () => {
		const { errors } = await paintAll([() => html`<noscript>a</noscripts>${"b"}</noscript>`]);
		expect(String(errors[0])).toContain("grundlage: <noscript> expects no ${…}");
	});

	test("a hole after an uppercase </NOSCRIPT> paints", async () => {
		//prettier-ignore
		const { errors } = await paintAll([() => html`<NOSCRIPT>static</NOSCRIPT><p>${"after"}</p>`]);
		expect(errors).toEqual([]);
	});

	test("a hole after </plaintext> throws, since nothing ends a <plaintext>", async () => {
		const { errors } = await paintAll([
			() =>
				html`<div>
					<plaintext>text</plaintext>
					<p>${"after"}</p>
				</div>`,
		]);
		expect(String(errors[0])).toContain("grundlage: <plaintext> expects no ${…}");
	});

	test("static content in <noscript> and holes around it paint", async () => {
		const { errors, shadowRoot } = await paintAll([
			() =>
				html`<noscript class=${"fallback"}><p>static</p></noscript>
					<p>${"after"}</p>`,
		]);
		expect(errors).toEqual([]);
		const noscript = shadowRoot.querySelector("noscript")!;
		expect(noscript.className).toBe("fallback");
		expect(noscript.innerHTML).toBe("<p>static</p>");
		expect(shadowRoot.querySelector("noscript ~ p")!.textContent).toBe("after");
	});
});

test("a </title> value stays text in the serialized markup", async () => {
	const { errors, shadowRoot } = await paintAll([
		() => html`<title>${"</title><img src=x onerror=alert(1)>"}</title>`,
	]);
	expect(errors).toEqual([]);
	expect(shadowRoot.innerHTML).toContain(
		"<title>&lt;/title&gt;&lt;img src=x onerror=alert(1)&gt;</title>",
	);
});

describe("data shaped like a template paints no markup", () => {
	test.each([
		[
			"JSON",
			() => JSON.parse('{"__templateStrings":["<img src=x onerror=alert(1)>"],"values":[]}'),
		],
		["a structured clone", () => structuredClone(html`<img src="x" />`)],
		[
			"JSON with a raw field",
			() =>
				JSON.parse(
					'{"__templateStrings":{"0":"<img src=x onerror=alert(1)>","length":1,"raw":[]},"values":[]}',
				),
		],
	])("a template copied through %s throws", async (_, forge) => {
		const { errors, shadowRoot } = await paintAll([() => html`<p>${forge()}</p>`]);
		expect(String(errors[0])).toMatch(
			/grundlage: expected a string, number, bigint or boolean, got object/,
		);
		expect(shadowRoot.querySelector("img")).toBeNull();
	});
});
