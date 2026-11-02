import { test, expect } from "vitest";
import { STYLE_SHEET_NOT_COMPILED } from "../../../parser/constants";
import { compileStyleSheet } from "../../../parser/css";
import {
	createRandom,
	generateSheet,
} from "../../../parser/__tests__/css-sheet-generator";
import { composeParts } from "../../compose";
import {
	commitChangedDeclarations,
	createCSSOMStyleSheetLane,
	matchCompiledStyleSheet,
	RULE_STRUCTURE_MISMATCH,
	seedDeclarationValueHashes,
} from "../style-sheet";

//the browser is the oracle: every holed block the compiler names must hold its property with the
//value a scratch rule serializes for the same text
const scratchStyle = (() => {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync("x{}");
	return (sheet.cssRules[0] as CSSStyleRule).style;
})();

const expectedSerialization = (
	propertyName: string,
	value: string,
	priority: string,
) => {
	scratchStyle.cssText = "";
	scratchStyle.setProperty(propertyName, value, priority);
	return `${scratchStyle.getPropertyValue(propertyName)}|${scratchStyle.getPropertyPriority(propertyName)}`;
};

//happy-dom has no CSSOM structure to ask
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

test.runIf(isRealBrowser).each([7, 8, 9])(
	"every compiled address lands on the block the browser built, before and after updates (seed %i)",
	(seed) => {
		const random = createRandom(seed);
		const tally = {
			compiled: 0,
			structureMismatch: 0,
			checkedDeclarations: 0,
			reinsertedRules: 0,
		};
		const wrong: Array<string> = [];
		for (let caseIndex = 0; caseIndex < 3000 && wrong.length < 8; caseIndex++) {
			const { parts, holeValues } = generateSheet(random);
			const compiled = compileStyleSheet(parts);
			if (compiled === STYLE_SHEET_NOT_COMPILED) continue;
			tally.compiled++;
			const host = document.createElement("div");
			const root = host.attachShadow({ mode: "open" });
			const style = document.createElement("style");
			style.textContent = composeParts(parts, holeValues);
			root.append(style);
			document.body.append(host);
			const lane = createCSSOMStyleSheetLane(compiled, style);
			const bound = matchCompiledStyleSheet(compiled, style.sheet!);
			if (bound === RULE_STRUCTURE_MISMATCH) {
				tally.structureMismatch++;
				host.remove();
				continue;
			}
			lane.boundSheet = bound;
			seedDeclarationValueHashes(lane, holeValues);
			const check = (values: Array<number>, label: string) => {
				for (
					let ruleIndex = 0;
					ruleIndex < compiled.holedRules.length;
					ruleIndex++
				)
					for (const declaration of compiled.holedRules[ruleIndex]
						.declarations) {
						const block = bound.ruleDeclarations[ruleIndex];
						const actual = `${block.getPropertyValue(declaration.propertyName)}|${block.getPropertyPriority(declaration.propertyName)}`;
						const expected = expectedSerialization(
							declaration.propertyName,
							composeParts(declaration.valueParts, values),
							declaration.priority,
						);
						tally.checkedDeclarations++;
						if (actual !== expected)
							wrong.push(
								`${label} ${declaration.propertyName} at ${compiled.holedRules[ruleIndex].rulePath}: ${actual} vs ${expected} in ${parts.join("${}")}`,
							);
					}
			};
			check(holeValues, "mount");
			const nextValues = holeValues.map((value) => value + 3);
			commitChangedDeclarations(lane, bound, nextValues);
			tally.reinsertedRules += compiled.holedRules.filter(
				(holedRule) => typeof holedRule.reinsertedRulePath !== "symbol",
			).length;
			check(nextValues, "update");
			const rematched = matchCompiledStyleSheet(compiled, style.sheet!);
			if (rematched === RULE_STRUCTURE_MISMATCH)
				wrong.push(`structure changed by re-insertion in ${parts.join("${}")}`);
			host.remove();
		}
		expect({ tally, wrong }).toEqual({ tally, wrong: [] });
		expect(tally.compiled - tally.structureMismatch).toBeGreaterThan(500);
	},
);
