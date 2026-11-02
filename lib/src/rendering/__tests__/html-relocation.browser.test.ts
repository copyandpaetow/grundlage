import { describe, expect, test } from "vitest";
import { getParsedTemplate } from "../../parser/html";
import { buildFragment } from "../dom";
import { ensureFragmentKeptEveryBinding } from "../markers";

//only a real HTML parser relocates; happy-dom keeps the markup as written
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const ensureKept = (
	strings: TemplateStringsArray,
	..._values: Array<unknown>
) => {
	const parsed = getParsedTemplate(strings);
	ensureFragmentKeptEveryBinding(buildFragment(parsed.htmlWithMarkers), parsed);
};

describe.runIf(isRealBrowser)("bindings the HTML parser moves", () => {
	test("a bound attribute on a block inside <p> names the fix", () => {
		expect(() => ensureKept`<p><section lang=${"x"}></section></p>`).toThrow(
			/Fix the nesting/,
		);
	});

	test("a bound attribute on a bare <tr> is not given to the implied <tbody>", () => {
		expect(
			() => ensureKept`<table><tr class=${"x"}><td></td></tr></table>`,
		).toThrow(/Fix the nesting/);
	});

	test("a <tr> inside a written <tbody> keeps its binding", () => {
		expect(
			() =>
				ensureKept`<table><tbody><tr class=${"x"}><td></td></tr></tbody></table>`,
		).not.toThrow();
	});

	test("a bound <p> moved out of a <table> names the fix", () => {
		expect(() => ensureKept`<table>${"a"}<p>${"b"}</p></table>`).toThrow(
			/Fix the nesting/,
		);
	});

	test("a bound <b> the parser copies past a block inside <p> names the fix", () => {
		expect(() => ensureKept`<p><b class=${"x"}>a<div>b</div></b></p>`).toThrow(
			/copied by the HTML parser/,
		);
	});

	test("a bound <i> the parser copies past a misnested end tag names the fix", () => {
		expect(() => ensureKept`<b><i class=${"x"}>a</b>b</i>`).toThrow(
			/copied by the HTML parser/,
		);
	});

	test("a bound <b> nested as written is kept", () => {
		expect(
			() => ensureKept`<p><b class=${"x"}>a</b><b>c</b></p><div>b</div>`,
		).not.toThrow();
	});

	test("a bound <textarea> moved out of a <table> names the fix", () => {
		expect(
			() => ensureKept`<table><textarea>${"a"}</textarea></table>`,
		).toThrow(/Fix the nesting/);
	});
});
