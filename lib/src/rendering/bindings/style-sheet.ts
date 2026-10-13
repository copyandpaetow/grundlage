import { CompiledStyleSheet } from "../../parser/types";
import { BaseComponent } from "../../types";
import { assertDuringDevelopment } from "../../utils/diagnostics";
import { combinedPartsHash, composeParts } from "../compose";
import { STYLE_SHEET_LANE, UNSET_HASH } from "../constants";
import {
	BoundStyleSheet,
	CSSOMStyleSheetLane,
	RawContentLiveBinding,
	TextStyleSheetLane,
} from "./types";

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
		compiledStyleSheet.dynamicDeclarations.length,
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
): CSSRule | null => {
	let childRules: CSSRuleList | undefined = sheet.cssRules;
	let rule: CSSRule | null = null;
	for (let index = 0; index < rulePath.length; index++) {
		if (childRules === undefined) return null;
		const nextRule: CSSRule | undefined = childRules[rulePath[index]];
		if (nextRule === undefined) return null;
		rule = nextRule;
		childRules = childRulesOf(rule);
	}
	return rule;
};

export const RULE_STRUCTURE_MISMATCH: unique symbol = Symbol(
	"rule structure mismatch",
);

//the browser drops rules it cannot parse, shifting every later sibling index — the counts
//recorded at compile time must match at every level a dynamic path runs through
export const matchCompiledStyleSheet = (
	compiled: CompiledStyleSheet,
	sheet: CSSStyleSheet,
): BoundStyleSheet | typeof RULE_STRUCTURE_MISMATCH => {
	const { ruleCountChecks, dynamicDeclarations } = compiled;
	for (let index = 0; index < ruleCountChecks.length; index++) {
		const check = ruleCountChecks[index];
		const childRules =
			check.rulePath.length === 0
				? sheet.cssRules
				: childRulesOf(findRuleAtPath(sheet, check.rulePath));
		const hasExpectedRuleCount =
			childRules !== undefined && childRules.length === check.expectedRuleCount;
		if (!hasExpectedRuleCount) return RULE_STRUCTURE_MISMATCH;
	}
	const ruleDeclarations: Array<CSSStyleDeclaration> = new Array(
		dynamicDeclarations.length,
	);
	for (let index = 0; index < dynamicDeclarations.length; index++) {
		const rule = findRuleAtPath(sheet, dynamicDeclarations[index].rulePath);
		const declarationBlock = (rule as CSSStyleRule | null)?.style;
		if (declarationBlock === undefined) return RULE_STRUCTURE_MISMATCH;
		ruleDeclarations[index] = declarationBlock;
	}
	return { sheet, ruleDeclarations };
};

export const commitChangedDeclarations = (
	lane: CSSOMStyleSheetLane,
	boundSheet: BoundStyleSheet,
	values: Array<unknown>,
): void => {
	const { dynamicDeclarations } = lane.compiledStyleSheet;
	const { declarationValueHashes } = lane;
	const { ruleDeclarations } = boundSheet;
	for (let index = 0; index < dynamicDeclarations.length; index++) {
		const declaration = dynamicDeclarations[index];
		const valueHash = combinedPartsHash(declaration.valueParts, values);
		if (valueHash === declarationValueHashes[index]) continue;
		declarationValueHashes[index] = valueHash;
		ruleDeclarations[index].setProperty(
			declaration.propertyName,
			composeParts(declaration.valueParts, values),
			declaration.priority,
		);
	}
};

export const seedDeclarationValueHashes = (
	lane: CSSOMStyleSheetLane,
	values: Array<unknown>,
): void => {
	const { dynamicDeclarations } = lane.compiledStyleSheet;
	const { declarationValueHashes } = lane;
	for (let index = 0; index < dynamicDeclarations.length; index++)
		declarationValueHashes[index] = combinedPartsHash(
			dynamicDeclarations[index].valueParts,
			values,
		);
};

//copies each hole's serialized value/priority off the orphaned pre-move sheet — no render
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
		//no values to rebuild with: demote and re-render onto the text lane
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
	const { dynamicDeclarations } = lane.compiledStyleSheet;
	for (let index = 0; index < dynamicDeclarations.length; index++) {
		const { propertyName } = dynamicDeclarations[index];
		const orphanedDeclaration = orphanedSheet.ruleDeclarations[index];
		matchedSheet.ruleDeclarations[index].setProperty(
			propertyName,
			orphanedDeclaration.getPropertyValue(propertyName),
			orphanedDeclaration.getPropertyPriority(propertyName),
		);
	}
	lane.boundSheet = matchedSheet;
};
