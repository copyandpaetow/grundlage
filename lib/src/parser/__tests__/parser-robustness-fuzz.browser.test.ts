import { expect, test } from "vitest";
import { component, html } from "../../index";
import { ensureFragmentKeptEveryBinding } from "../../rendering/markers";
import { buildFragment } from "../../rendering/dom";
import { BaseComponent } from "../../types";
import { InvariantError } from "../../utils/diagnostics";
import * as BINDING from "../binding";
import { NO_KEY, STYLE_SHEET_NOT_COMPILED } from "../constants";
import { compileStyleSheet } from "../css";
import { getParsedTemplate } from "../html";
import { ParsedTemplate, Part } from "../types";
import { createRandom } from "./html-template-generator";

//token soup: whatever the parsers make of it, they answer with a result or a library error, never a
//crash, an invariant or a hole read twice
const isRealBrowser = typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const HOLE = null;
type Token = string | typeof HOLE;

const HTML_TOKENS: ReadonlyArray<Token> = [
	HOLE,
	HOLE,
	HOLE,
	"<",
	">",
	"</",
	"/>",
	"/",
	"<div",
	"<p",
	"<b>",
	"</div>",
	"</p>",
	"</b>",
	"<br>",
	"<style>",
	"</style>",
	"<textarea>",
	"</textarea>",
	"<script>",
	"</script>",
	"<!--",
	"-->",
	"<!",
	"<![CDATA[",
	"]]>",
	"<template>",
	"</template>",
	"<select>",
	"<option>",
	"<svg>",
	"</svg>",
	"<table>",
	"<tr>",
	" ",
	"\n",
	"=",
	`"`,
	"'",
	"a",
	" class",
	" on-x",
	" onClick",
	"&amp;",
	"&",
	"{",
	"}",
	":",
	";",
];

const CSS_TOKENS: ReadonlyArray<Token> = [
	HOLE,
	HOLE,
	HOLE,
	"{",
	"}",
	";",
	":",
	" ",
	"\n",
	`"`,
	"'",
	"/*",
	"*/",
	"\\",
	"(",
	")",
	"[",
	"]",
	",",
	"@media (x)",
	"@keyframes k",
	"@layer",
	"@import",
	"!important",
	"&",
	":host",
	".a",
	"p",
	"color",
	"--x",
	"width",
	"px",
	"url(",
	"<!--",
	"-->",
	"}}",
];

const stringsOf = (random: () => number, tokens: ReadonlyArray<Token>) => {
	const strings: Array<string> = [""];
	const tokenCount = 1 + Math.floor(random() * 30);
	for (let index = 0; index < tokenCount; index++) {
		const token = tokens[Math.floor(random() * tokens.length)];
		if (token === HOLE) strings.push("");
		else strings[strings.length - 1] += token;
	}
	return strings;
};

const asTemplateStrings = (strings: Array<string>) =>
	//a hand-built strings array stands in for the one a tagged template hands over
	Object.assign([...strings], {
		raw: [...strings],
	}) as unknown as TemplateStringsArray;

const isLibraryError = (error: unknown) =>
	error instanceof Error &&
	!(error instanceof InvariantError) &&
	error.message.startsWith("grundlage: ");

const holeIndexesOf = (parsed: ParsedTemplate): Array<number> => {
	const indexes: Array<number> = [];
	const collect = (parts: ReadonlyArray<Part>) => {
		for (const part of parts) if (typeof part === "number") indexes.push(part);
	};
	for (const binding of parsed.bindings) {
		switch (binding.type) {
			case BINDING.TAG:
			case BINDING.RAW_CONTENT:
			case BINDING.COMMENT:
				collect(binding.parts);
				break;
			case BINDING.ATTRIBUTE:
				collect(binding.nameParts);
				collect(binding.valueParts);
				break;
			case BINDING.DYNAMIC_ATTRIBUTE:
			case BINDING.CONTENT:
				indexes.push(binding.valueIndex);
				break;
			case BINDING.TEMPLATE_CONTENT:
				indexes.push(...holeIndexesOf(binding.content));
				break;
			default:
				binding satisfies never;
		}
	}
	return indexes;
};

const describeError = (error: unknown) =>
	error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);

test.each([1, 2, 3])(
	"the html parser answers every token soup with a result or a library error (seed %i)",
	(seed) => {
		const random = createRandom(seed);
		const tally = { parsed: 0, refused: 0, refusedByFragmentCheck: 0 };
		const wrong: Array<string> = [];
		for (let caseIndex = 0; caseIndex < 5000 && wrong.length < 8; caseIndex++) {
			const strings = stringsOf(random, HTML_TOKENS);
			const source = strings.join("${}");
			let parsed: ParsedTemplate;
			try {
				parsed = getParsedTemplate(asTemplateStrings(strings));
			} catch (error) {
				if (isLibraryError(error)) tally.refused++;
				else wrong.push(`parse ${describeError(error)} in ${source}`);
				continue;
			}
			tally.parsed++;
			const holeIndexes = [
				...holeIndexesOf(parsed),
				...(parsed.keyValueParts === NO_KEY
					? []
					: parsed.keyValueParts.filter((part) => typeof part === "number")),
			];
			const isEachHoleReadOnce =
				new Set(holeIndexes).size === holeIndexes.length &&
				holeIndexes.every((index) => index >= 0 && index < strings.length - 1);
			if (!isEachHoleReadOnce) wrong.push(`holes ${JSON.stringify(holeIndexes)} in ${source}`);
			if (!isRealBrowser) continue;
			try {
				ensureFragmentKeptEveryBinding(buildFragment(parsed.htmlWithMarkers), parsed);
			} catch (error) {
				if (isLibraryError(error)) tally.refusedByFragmentCheck++;
				else wrong.push(`fragment ${describeError(error)} in ${source}`);
			}
		}
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
	},
);

let currentStrings: TemplateStringsArray | null = null;
let currentValues: Array<unknown> = [];
const SOUP_TAG = "parser-robustness-fuzz";
customElements.define(
	SOUP_TAG,
	component(function* () {
		yield function* view() {
			yield html(currentStrings!, ...currentValues);
		};
	}),
);

const UNSETTLED = "unsettled";
const settledWithin = (update: Promise<void>) =>
	Promise.race([
		update,
		new Promise<typeof UNSETTLED>((resolve) => setTimeout(() => resolve(UNSETTLED), 1000)),
	]);

const SOUP_VALUES = ["x", "", "section", 3, null, false, true, { a: "b" }, ["c"]];

test.runIf(isRealBrowser).each([4, 5])(
	"a painted token soup ends in a paint or a library error, never an invariant or a hang (seed %i)",
	async (seed) => {
		const random = createRandom(seed);
		const tally = { painted: 0, refused: 0 };
		const wrong: Array<string> = [];
		const errors: Array<unknown> = [];
		const recordComponentError = (event: Event) => {
			event.preventDefault();
			errors.push((event as Event & { error: unknown }).error);
		};
		const recordUncaught = (event: ErrorEvent) => {
			event.preventDefault();
			errors.push(event.error);
		};
		document.addEventListener("grundlage-error", recordComponentError);
		window.addEventListener("error", recordUncaught);
		for (let caseIndex = 0; caseIndex < 600 && wrong.length < 8; caseIndex++) {
			const strings = stringsOf(random, HTML_TOKENS);
			const source = strings.join("${}");
			try {
				getParsedTemplate(asTemplateStrings(strings));
			} catch {
				//the parse-only test covers refusals; only what parses is painted
				continue;
			}
			currentStrings = asTemplateStrings(strings);
			const valuesOf = () =>
				strings.slice(1).map(() => SOUP_VALUES[Math.floor(random() * SOUP_VALUES.length)]);
			currentValues = valuesOf();
			const errorCountBefore = errors.length;
			const host = document.createElement(SOUP_TAG) as BaseComponent;
			document.body.append(host);
			let settled = (await settledWithin(host.update())) !== UNSETTLED;
			if (settled && errors.length === errorCountBefore) {
				currentValues = valuesOf();
				settled = (await settledWithin(host.update())) !== UNSETTLED;
			}
			host.remove();
			const newErrors = errors.slice(errorCountBefore);
			const unexpected = newErrors.filter((error) => !isLibraryError(error));
			if (unexpected.length > 0) {
				wrong.push(
					`${unexpected.map(describeError).join(" / ")} in ${source} with ${JSON.stringify(currentValues)}`,
				);
			} else if (!settled && newErrors.length === 0) {
				wrong.push(`never settled without an error in ${source}`);
			} else if (newErrors.length > 0) tally.refused++;
			else tally.painted++;
		}
		document.removeEventListener("grundlage-error", recordComponentError);
		window.removeEventListener("error", recordUncaught);
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
	},
	120_000,
);

test.each([1, 2, 3])(
	"the css compiler answers every token soup with a result or a fallback, never a throw (seed %i)",
	(seed) => {
		const random = createRandom(seed);
		const tally = { compiled: 0, notCompiled: 0 };
		const wrong: Array<string> = [];
		for (let caseIndex = 0; caseIndex < 20000 && wrong.length < 8; caseIndex++) {
			const strings = stringsOf(random, CSS_TOKENS);
			const parts: Array<Part> = [strings[0]];
			for (let index = 1; index < strings.length; index++) parts.push(index - 1, strings[index]);
			try {
				const compiled = compileStyleSheet(parts);
				if (compiled === STYLE_SHEET_NOT_COMPILED) tally.notCompiled++;
				else tally.compiled++;
			} catch (error) {
				wrong.push(`${describeError(error)} in ${strings.join("${}")}`);
			}
		}
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
	},
);
