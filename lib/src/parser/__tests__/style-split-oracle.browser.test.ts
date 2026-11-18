import { expect, inject, test } from "vitest";
import { composeParts } from "../../rendering/compose";
import { getParsedTemplate } from "../html";
import { Part, RawContentStaticBinding } from "../types";
import { createRandom, generateSheet } from "./css-sheet-generator";

//the browser is the oracle: the rules of the split <style> elements, read in order, are the rules it
//reads from the whole sheet, so every cut falls between two of its rules
const isRealBrowser = typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

//npm run fuzz raises the count and moves the first seed; npm test keeps the defaults
const seedsFrom = (defaultFirstSeed: number, defaultCount: number): Array<number> => {
	const firstSeed = inject("fuzzFirstSeed") ?? defaultFirstSeed;
	const count = defaultCount * inject("fuzzScale");
	return Array.from({ length: count }, (_, index) => firstSeed + index);
};

const styleTemplateOf = (parts: ReadonlyArray<Part>) => {
	const strings = parts.filter((part) => typeof part === "string");
	strings[0] = `<style>${strings[0]}`;
	strings[strings.length - 1] += "</style>";
	//a hand-built strings array stands in for the one a tagged template hands over
	return Object.assign(strings, { raw: [...strings] }) as unknown as TemplateStringsArray;
};

const rulesOf = (root: ShadowRoot) =>
	Array.from(root.querySelectorAll("style")).flatMap((style) =>
		Array.from(style.sheet!.cssRules, (rule) => rule.cssText),
	);

test.runIf(isRealBrowser).each(seedsFrom(7, 3))(
	"the split sheets hold the rules the browser reads from the whole sheet (seed %i)",
	(seed) => {
		const random = createRandom(seed);
		const tally = { sheets: 0, splitSheets: 0 };
		const wrong: Array<string> = [];
		const host = document.createElement("div");
		document.body.append(host);
		const root = host.attachShadow({ mode: "open" });
		for (let caseIndex = 0; caseIndex < 2000 && wrong.length < 8; caseIndex++) {
			const { parts, holeValues } = generateSheet(random);
			const parsed = getParsedTemplate(styleTemplateOf(parts));
			root.innerHTML = parsed.htmlWithMarkers;
			for (const node of Array.from(root.childNodes)) {
				if (!(node instanceof Comment)) continue;
				const bindingIndex = Number(node.data.slice(node.data.indexOf("-") + 1));
				const binding = parsed.bindings[bindingIndex] as RawContentStaticBinding;
				node.nextElementSibling!.textContent = composeParts(binding.parts, holeValues);
			}
			const splitRules = rulesOf(root);
			tally.sheets++;
			if (root.querySelectorAll("style").length > 1) tally.splitSheets++;

			root.innerHTML = "<style></style>";
			root.firstElementChild!.textContent = composeParts(parts, holeValues);
			const wholeRules = rulesOf(root);
			if (splitRules.join("\n") !== wholeRules.join("\n")) {
				wrong.push(
					`${splitRules.join("\n")}\n  vs\n${wholeRules.join("\n")}\n  in ${parts.join("${}")}`,
				);
			}
		}
		host.remove();
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
		expect(tally.splitSheets).toBeGreaterThan(500);
	},
);
