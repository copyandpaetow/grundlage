import { CompiledStyleSheet } from "../../parser/types";
import { BaseComponent } from "../../types";
import { combinedPartsHash, composeParts } from "../compose";
import { UNSET_HASH } from "../constants";
import { RawContentLiveBinding, StyleSheetState } from "./types";

export const createStyleSheetState = (
	compiled: CompiledStyleSheet,
	styleElement: HTMLStyleElement,
): StyleSheetState => ({
	styleElement,
	declarationValueHashes: new Array<number>(
		compiled.dynamicDeclarations.length,
	).fill(UNSET_HASH),
	ruleDeclarations: [],
	sheet: null,
});

//grouping/keyframes rules expose children as cssRules, leaf rules expose none; duck-read
//because the rule classes (CSSNestedDeclarations, CSSScopeRule, …) lack stable
//cross-browser constructors — this is a platform surface, not one of our brands
const childRulesOf = (rule: CSSRule | null): CSSRuleList | undefined =>
	(rule as CSSGroupingRule | null)?.cssRules;

const resolveRulePath = (
	sheet: CSSStyleSheet,
	rulePath: Array<number>,
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

//the browser drops rules it cannot parse, shifting every later sibling index — the counts
//recorded at compile time must match at every level a dynamic path runs through
const resolveRuleDeclarations = (
	compiled: CompiledStyleSheet,
	sheet: CSSStyleSheet,
): Array<CSSStyleDeclaration> | null => {
	const { ruleCountChecks, dynamicDeclarations } = compiled;
	for (let index = 0; index < ruleCountChecks.length; index++) {
		const check = ruleCountChecks[index];
		const childRules =
			check.rulePath.length === 0
				? sheet.cssRules
				: childRulesOf(resolveRulePath(sheet, check.rulePath));
		if (
			childRules === undefined ||
			childRules.length !== check.expectedRuleCount
		)
			return null;
	}
	const ruleDeclarations: Array<CSSStyleDeclaration> = new Array(
		dynamicDeclarations.length,
	);
	for (let index = 0; index < dynamicDeclarations.length; index++) {
		const rule = resolveRulePath(sheet, dynamicDeclarations[index].rulePath);
		const declarationBlock = (rule as CSSStyleRule | null)?.style;
		if (declarationBlock === undefined) return null;
		ruleDeclarations[index] = declarationBlock;
	}
	return ruleDeclarations;
};

const applyChangedDeclarations = (
	compiled: CompiledStyleSheet,
	state: StyleSheetState,
	values: Array<unknown>,
): void => {
	const { dynamicDeclarations } = compiled;
	const { declarationValueHashes, ruleDeclarations } = state;
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

export const commitStyleSheetDirect = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): boolean => {
	const state = liveBinding.styleSheetState!;
	const compiled = liveBinding.staticBinding.compiledStyleSheet!;
	const liveSheet = state.styleElement.sheet;
	if (liveSheet === null) return false;
	if (state.sheet !== liveSheet) {
		const ruleDeclarations = resolveRuleDeclarations(compiled, liveSheet);
		if (ruleDeclarations === null) {
			liveBinding.styleSheetState = null;
			return false;
		}
		//a reparse restored the last written text — every hole must be rewritten
		if (state.sheet) state.declarationValueHashes.fill(UNSET_HASH);
		state.ruleDeclarations = ruleDeclarations;
		state.sheet = liveSheet;
	}
	applyChangedDeclarations(compiled, state, values);
	return true;
};

export const seedDeclarationValueHashes = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const { dynamicDeclarations } = liveBinding.staticBinding.compiledStyleSheet!;
	const { declarationValueHashes } = liveBinding.styleSheetState!;
	for (let index = 0; index < dynamicDeclarations.length; index++)
		declarationValueHashes[index] = combinedPartsHash(
			dynamicDeclarations[index].valueParts,
			values,
		);
};

//copies each hole's serialized value/priority off the orphaned pre-move sheet — no render
//values are on hand at move time to recompose from
export const rebindStyleSheet = (liveBinding: RawContentLiveBinding): void => {
	const state = liveBinding.styleSheetState;
	if (state === null || state.sheet === null) return;
	const liveSheet = state.styleElement.sheet;
	if (liveSheet === state.sheet) return;
	const compiled = liveBinding.staticBinding.compiledStyleSheet!;
	const ruleDeclarations =
		liveSheet === null ? null : resolveRuleDeclarations(compiled, liveSheet);
	if (ruleDeclarations === null) {
		//no values to rebuild with — demote and re-render onto the text lane. a style element's
		//root node is the component's own shadow root in every mode, closed included
		liveBinding.styleSheetState = null;
		liveBinding.lastValueHash = UNSET_HASH;
		const host = (state.styleElement.getRootNode() as ShadowRoot)
			.host as BaseComponent;
		host.update();
		return;
	}
	const { dynamicDeclarations } = compiled;
	for (let index = 0; index < dynamicDeclarations.length; index++) {
		const { propertyName } = dynamicDeclarations[index];
		const orphanedDeclaration = state.ruleDeclarations[index];
		ruleDeclarations[index].setProperty(
			propertyName,
			orphanedDeclaration.getPropertyValue(propertyName),
			orphanedDeclaration.getPropertyPriority(propertyName),
		);
	}
	state.ruleDeclarations = ruleDeclarations;
	state.sheet = liveSheet;
};
