import { describe, expect, test } from "vitest";
import { getParsedTemplate } from "../html";
import { BINDING } from "../constants";
import { composeParts } from "../../rendering/compose";

//happy-dom's parser skips RCDATA decoding, so only chromium is an oracle
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const HOLE_VALUE = "v";

const templateStringsOf = (
	before: string,
	after: string,
): TemplateStringsArray => {
	const strings = [`<textarea>${before}`, `${after}</textarea>`];
	return Object.assign(strings, {
		raw: strings.slice(),
	}) as unknown as TemplateStringsArray;
};

const composedByGrundlage = (before: string, after: string): string => {
	const parsed = getParsedTemplate(templateStringsOf(before, after));
	const binding = parsed.bindings.find(
		(binding) => binding.type === BINDING.RAW_CONTENT,
	);
	if (binding === undefined || binding.type !== BINDING.RAW_CONTENT)
		throw new Error("expected a raw content binding");
	return composeParts(binding.parts, [HOLE_VALUE]);
};

const parsedByBrowser = (before: string, after: string): string => {
	const host = document.createElement("div");
	host.innerHTML = `<textarea>${before}${HOLE_VALUE}${after}</textarea>`;
	return host.firstElementChild!.textContent!;
};

describe.skipIf(!isRealBrowser)(
	"textarea static parts beside a hole decode as the browser parser does",
	() => {
		const cases: Array<[label: string, before: string, after: string]> = [
			["one leading line feed", "\nPorridge ", ""],
			["only the first of two leading line feeds", "\n\nPorridge ", ""],
			["a leading CRLF", "\r\nPorridge ", ""],
			["a leading line feed from a reference", "&#10;Porridge ", ""],
			["a line feed after the hole", "", "\nPorridge"],
			["an inner CR and CRLF", "a\rb\r\nc ", ""],
			["NULL", "a\0b ", ""],
			[
				"the named subset",
				"&amp; &lt; &gt; &quot; &apos; &nbsp; ",
				"&AMP; &LT; &GT; &QUOT;",
			],
			[
				"legacy forms without a semicolon",
				"&amp &lt, &gt. &quot&nbsp ",
				"&AMP",
			],
			["numeric references", "&#65; &#x42; &#X43; &#68x ", "&#x45"],
			[
				"numeric replacement cases",
				"&#0; &#xD800; &#x110000; &#99999999999; ",
				"",
			],
			["the windows-1252 remap", "&#128; &#x9F; &#x81; ", ""],
			["a bare ampersand", "Salt & pepper &# &#x; ", "&"],
		];
		for (const [label, before, after] of cases) {
			test(label, () => {
				expect(composedByGrundlage(before, after)).toBe(
					parsedByBrowser(before, after),
				);
			});
		}
	},
);

describe("a named reference outside the subset is a definition error", () => {
	const references = [
		"AT&T ",
		"&copy; ",
		"&copy2024 ",
		"&ltimes; ",
		"&ampx ",
		"&apos ",
	];
	for (const reference of references) {
		test(reference.trim(), () => {
			expect(() => composedByGrundlage(reference, "")).toThrow(/&amp;/);
		});
	}
});

test("a textarea without a hole stays markup for the browser to decode", () => {
	const strings = Object.assign(["<textarea>\nSalt &amp; pepper</textarea>"], {
		raw: ["<textarea>\nSalt &amp; pepper</textarea>"],
	}) as unknown as TemplateStringsArray;
	expect(getParsedTemplate(strings).bindings).toHaveLength(0);
});
