import { expect, inject, test } from "vitest";
import { STYLE_SHEET_NOT_COMPILED } from "../../../parser/constants";
import { compileStyleSheet } from "../../../parser/css";
import { createRandom, generateSheet } from "../../../parser/__tests__/css-sheet-generator";
import { Part } from "../../../parser/types";
import { composeParts } from "../../compose";
import {
	commitChangedDeclarations,
	createCSSOMStyleSheetLane,
	matchCompiledStyleSheet,
	RULE_STRUCTURE_MISMATCH,
	seedDeclarationValueHashes,
} from "../style-sheet";

//well-formed sheets with random edits in their static text: wherever the compiler still addresses
//declarations, CSSOM updates must leave the sheet the browser builds from the updated text
const isRealBrowser = typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

//npm run fuzz raises the count and moves the first seed; npm test keeps the defaults
const seedsFrom = (defaultFirstSeed: number, defaultCount: number): Array<number> => {
	const firstSeed = inject("fuzzFirstSeed") ?? defaultFirstSeed;
	const count = defaultCount * inject("fuzzScale");
	return Array.from({ length: count }, (_, index) => firstSeed + index);
};

const EDIT_TOKENS = [
	"{",
	"}",
	";",
	":",
	" ",
	`"`,
	"'",
	"/*",
	"*/",
	"\\",
	"(",
	")",
	"!important",
	"&",
	"@media (x) {",
	":host",
	".z",
	"color: blue;",
	"width: 1px;",
	"--v: {}",
	"<!--",
	"-->",
	"url(",
	"@keyframes k {",
];

const mutatedParts = (random: () => number, parts: ReadonlyArray<Part>) => {
	const mutated = [...parts];
	const editCount = Math.floor(random() * 4);
	for (let edit = 0; edit < editCount; edit++) {
		const textIndex = 2 * Math.floor(random() * Math.ceil(mutated.length / 2));
		const text = mutated[textIndex] as string;
		const position = Math.floor(random() * (text.length + 1));
		if (random() < 0.6) {
			const token = EDIT_TOKENS[Math.floor(random() * EDIT_TOKENS.length)];
			mutated[textIndex] = text.slice(0, position) + token + text.slice(position);
		} else {
			const length = 1 + Math.floor(random() * 4);
			mutated[textIndex] = text.slice(0, position) + text.slice(position + length);
		}
	}
	return mutated;
};

const serializedSheetOf = (sheet: CSSStyleSheet) =>
	Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");

const mountedStyle = (cssText: string) => {
	const host = document.createElement("div");
	const root = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = cssText;
	root.append(style);
	document.body.append(host);
	return { host, style };
};

test.runIf(isRealBrowser).each(seedsFrom(11, 3))(
	"CSSOM updates leave the sheet the updated text builds, for mutated sheets (seed %i)",
	(seed) => {
		const random = createRandom(seed);
		const tally = {
			compiled: 0,
			notCompiled: 0,
			structureMismatch: 0,
			updatesCompared: 0,
		};
		const wrong: Array<string> = [];
		for (let caseIndex = 0; caseIndex < 3000 && wrong.length < 6; caseIndex++) {
			const generated = generateSheet(random);
			const parts = mutatedParts(random, generated.parts);
			const compiled = compileStyleSheet(parts);
			if (compiled === STYLE_SHEET_NOT_COMPILED) {
				tally.notCompiled++;
				continue;
			}
			tally.compiled++;
			const { host, style } = mountedStyle(composeParts(parts, generated.holeValues));
			const bound = matchCompiledStyleSheet(compiled, style.sheet!);
			if (bound === RULE_STRUCTURE_MISMATCH) {
				tally.structureMismatch++;
				host.remove();
				continue;
			}
			const lane = createCSSOMStyleSheetLane(compiled, style);
			lane.boundSheet = bound;
			seedDeclarationValueHashes(lane, generated.holeValues);
			let values = generated.holeValues;
			for (let update = 0; update < 3; update++) {
				//some holes keep their value, so the change gate skips part of each rule
				values = values.map((value) =>
					random() < 0.3 ? value : value + 1 + Math.floor(random() * 5),
				);
				commitChangedDeclarations(lane, bound, values);
				const reference = mountedStyle(composeParts(parts, values));
				const painted = serializedSheetOf(style.sheet!);
				const expected = serializedSheetOf(reference.style.sheet!);
				reference.host.remove();
				tally.updatesCompared++;
				if (painted === expected) continue;
				wrong.push(
					`update ${update} of ${parts.map((part) => (typeof part === "number" ? "${}" : part)).join("")} with ${JSON.stringify(values)}\n  painted:  ${painted}\n  expected: ${expected}`,
				);
				break;
			}
			host.remove();
		}
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
		expect(tally.compiled - tally.structureMismatch).toBeGreaterThan(500);
	},
	120_000,
);
