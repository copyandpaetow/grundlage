import { NO_REINSERTION } from "../../parser/constants";
import { CompiledStyleSheet } from "../../parser/types";
import { BaseComponent } from "../../types";
import { assertDuringDevelopment } from "../../utils/diagnostics";
import { combinedPartsHash, composeParts } from "../compose";
import { UNSET_HASH } from "../constants";
import * as STYLE_SHEET_LANE from "../style-sheet-lane";
import {
	BoundStyleSheet,
	CSSOMStyleSheetLane,
	RawContentLiveBinding,
	TextStyleSheetLane,
} from "./types";
import { ensureStyleText } from "./verbatim-text";

export const TEXT_STYLE_SHEET_LANE: Readonly<TextStyleSheetLane> = {
	kind: STYLE_SHEET_LANE.TEXT,
};

export const createCSSOMStyleSheetLane = (
	compiledStyleSheet: CompiledStyleSheet,
	styleElement: HTMLStyleElement,
): CSSOMStyleSheetLane => ({
	kind: STYLE_SHEET_LANE.CSSOM,
	compiledStyleSheet,
	styleElement,
	declarationValueHashes: new Array<number>(
		compiledStyleSheet.declarationCount,
	).fill(UNSET_HASH),
	boundSheet: null,
});

//grouping and keyframes rules expose children as cssRules, leaf rules none. Duck-read: the rule
//classes lack stable cross-browser constructors, so this is platform surface, not our brand
const childRulesOf = (rule: CSSRule | null): CSSRuleList | undefined =>
	(rule as CSSGroupingRule | null)?.cssRules;

const findRuleAtPath = (
	sheet: CSSStyleSheet,
	rulePath: ReadonlyArray<number>,
	depth: number,
): CSSRule | null => {
	let childRules: CSSRuleList | undefined = sheet.cssRules;
	let rule: CSSRule | null = null;
	for (let index = 0; index < depth; index++) {
		if (childRules === undefined) return null;
		const nextRule: CSSRule | undefined = childRules[rulePath[index]];
		if (nextRule === undefined) return null;
		rule = nextRule;
		childRules = childRulesOf(rule);
	}
	return rule;
};

const declarationBlockAtPath = (
	sheet: CSSStyleSheet,
	rulePath: ReadonlyArray<number>,
): CSSStyleDeclaration | undefined =>
	//a style, keyframe and nested-declarations rule all carry .style; nothing else does
	(findRuleAtPath(sheet, rulePath, rulePath.length) as CSSStyleRule | null)
		?.style;

export const RULE_STRUCTURE_MISMATCH: unique symbol = Symbol(
	"rule structure mismatch",
);

//the browser drops rules it cannot parse, shifting every later sibling index — the counts
//recorded at compile time must match at every level a dynamic path runs through
export const matchCompiledStyleSheet = (
	compiled: CompiledStyleSheet,
	sheet: CSSStyleSheet,
): BoundStyleSheet | typeof RULE_STRUCTURE_MISMATCH => {
	const { ruleCountChecks, holedRules } = compiled;
	for (let index = 0; index < ruleCountChecks.length; index++) {
		const { rulePath, expectedRuleCount } = ruleCountChecks[index];
		const childRules =
			rulePath.length === 0
				? sheet.cssRules
				: childRulesOf(findRuleAtPath(sheet, rulePath, rulePath.length));
		const hasExpectedRuleCount =
			childRules !== undefined && childRules.length === expectedRuleCount;
		if (!hasExpectedRuleCount) return RULE_STRUCTURE_MISMATCH;
	}
	const ruleDeclarations: Array<CSSStyleDeclaration> = new Array(
		holedRules.length,
	);
	for (let index = 0; index < holedRules.length; index++) {
		const declarationBlock = declarationBlockAtPath(
			sheet,
			holedRules[index].rulePath,
		);
		if (declarationBlock === undefined) return RULE_STRUCTURE_MISMATCH;
		ruleDeclarations[index] = declarationBlock;
	}
	return { sheet, ruleDeclarations };
};

const isPathPrefix = (
	prefix: ReadonlyArray<number>,
	rulePath: ReadonlyArray<number>,
) => {
	if (prefix.length > rulePath.length) return false;
	for (let index = 0; index < prefix.length; index++)
		if (prefix[index] !== rulePath[index]) return false;
	return true;
};

//a rule re-inserted from its own text parses to the same structure, so only the blocks inside
//it change identity
const reinsertRule = (
	compiled: CompiledStyleSheet,
	boundSheet: BoundStyleSheet,
	rulePath: ReadonlyArray<number>,
): void => {
	const { sheet, ruleDeclarations } = boundSheet;
	const parentDepth = rulePath.length - 1;
	//a rule that holds a rule is a grouping or style rule, and both carry insertRule
	const parent =
		parentDepth === 0
			? sheet
			: (findRuleAtPath(sheet, rulePath, parentDepth) as CSSGroupingRule);
	const ruleIndex = rulePath[parentDepth];
	//inserted before the old copy is deleted, so a text the browser refuses loses nothing
	parent.insertRule(parent.cssRules[ruleIndex].cssText, ruleIndex);
	parent.deleteRule(ruleIndex + 1);
	const { holedRules } = compiled;
	for (let index = 0; index < holedRules.length; index++) {
		const holedRulePath = holedRules[index].rulePath;
		if (!isPathPrefix(rulePath, holedRulePath)) continue;
		const declarationBlock = declarationBlockAtPath(sheet, holedRulePath);
		assertDuringDevelopment(
			declarationBlock !== undefined,
			"a re-inserted rule keeps the structure its own text describes",
		);
		ruleDeclarations[index] = declarationBlock;
	}
};

export const commitChangedDeclarations = (
	lane: CSSOMStyleSheetLane,
	boundSheet: BoundStyleSheet,
	values: Array<unknown>,
): void => {
	const { compiledStyleSheet, declarationValueHashes } = lane;
	const { holedRules } = compiledStyleSheet;
	let declarationIndex = 0;
	for (let ruleIndex = 0; ruleIndex < holedRules.length; ruleIndex++) {
		const { declarations, reinsertedRulePath } = holedRules[ruleIndex];
		let hasChangedDeclaration = false;
		for (let index = 0; index < declarations.length; index++) {
			const declaration = declarations[index];
			const valueHash = combinedPartsHash(declaration.valueParts, values);
			const hashIndex = declarationIndex++;
			if (valueHash === declarationValueHashes[hashIndex]) continue;
			//the sheet's text never sees this value, but the same value would throw on the text lane
			const value = composeParts(declaration.valueParts, values);
			ensureStyleText(value);
			declarationValueHashes[hashIndex] = valueHash;
			hasChangedDeclaration = true;
			boundSheet.ruleDeclarations[ruleIndex].setProperty(
				declaration.propertyName,
				value,
				declaration.priority,
			);
		}
		const needsReinsertion =
			hasChangedDeclaration && reinsertedRulePath !== NO_REINSERTION;
		if (needsReinsertion)
			reinsertRule(compiledStyleSheet, boundSheet, reinsertedRulePath);
	}
};

export const seedDeclarationValueHashes = (
	lane: CSSOMStyleSheetLane,
	values: Array<unknown>,
): void => {
	const { holedRules } = lane.compiledStyleSheet;
	const { declarationValueHashes } = lane;
	let declarationIndex = 0;
	for (let ruleIndex = 0; ruleIndex < holedRules.length; ruleIndex++) {
		const { declarations } = holedRules[ruleIndex];
		for (let index = 0; index < declarations.length; index++)
			declarationValueHashes[declarationIndex++] = combinedPartsHash(
				declarations[index].valueParts,
				values,
			);
	}
};

//copies each hole's serialized value/priority off the orphaned pre-move sheet — no paint
//values are on hand at move time to recompose from
export const rebindStyleSheet = (liveBinding: RawContentLiveBinding): void => {
	const lane = liveBinding.styleSheetLane;
	if (lane.kind === STYLE_SHEET_LANE.TEXT) return;
	const orphanedSheet = lane.boundSheet;
	if (orphanedSheet === null) return;
	const liveSheet = lane.styleElement.sheet;
	if (liveSheet === orphanedSheet.sheet) return;
	const matchedSheet =
		liveSheet === null
			? RULE_STRUCTURE_MISMATCH
			: matchCompiledStyleSheet(lane.compiledStyleSheet, liveSheet);
	if (matchedSheet === RULE_STRUCTURE_MISMATCH) {
		//no values to rebuild with: demote and paint again onto the text lane
		liveBinding.styleSheetLane = TEXT_STYLE_SHEET_LANE;
		liveBinding.lastValueHash = UNSET_HASH;
		const componentShadowRoot = lane.styleElement.getRootNode();
		assertDuringDevelopment(
			componentShadowRoot instanceof ShadowRoot,
			"a style element's root node is its component's shadow root, closed included",
		);
		//a shadow root types its host as a plain Element
		const host = componentShadowRoot.host as BaseComponent;
		host.update();
		return;
	}
	const { holedRules } = lane.compiledStyleSheet;
	for (let ruleIndex = 0; ruleIndex < holedRules.length; ruleIndex++) {
		const { declarations } = holedRules[ruleIndex];
		const orphanedDeclarations = orphanedSheet.ruleDeclarations[ruleIndex];
		const liveDeclarations = matchedSheet.ruleDeclarations[ruleIndex];
		for (let index = 0; index < declarations.length; index++) {
			const { propertyName } = declarations[index];
			liveDeclarations.setProperty(
				propertyName,
				orphanedDeclarations.getPropertyValue(propertyName),
				orphanedDeclarations.getPropertyPriority(propertyName),
			);
		}
	}
	lane.boundSheet = matchedSheet;
};
