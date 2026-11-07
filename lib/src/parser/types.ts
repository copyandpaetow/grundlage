import { NO_KEY, NO_REINSERTION, STYLE_SHEET_NOT_COMPILED } from "./constants";
import * as BINDING from "./binding";

export type Part = string | number;

export interface HoledDeclaration {
	readonly propertyName: string;
	readonly priority: string;
	readonly valueParts: ReadonlyArray<Part>;
}

export interface HoledRule {
	readonly rulePath: ReadonlyArray<number>;
	readonly reinsertedRulePath: ReadonlyArray<number> | typeof NO_REINSERTION;
	readonly declarations: ReadonlyArray<HoledDeclaration>;
}

export interface RuleCountCheck {
	readonly rulePath: ReadonlyArray<number>;
	readonly expectedRuleCount: number;
}

export interface CompiledStyleSheet {
	readonly holedRules: ReadonlyArray<HoledRule>;
	readonly ruleCountChecks: ReadonlyArray<RuleCountCheck>;
	readonly declarationCount: number;
}

export interface TagStaticBinding {
	readonly type: typeof BINDING.TAG;
	readonly parts: ReadonlyArray<Part>;
}

//elementName is the tag as written, so a fragment check can tell the bound element from one the
//HTML parser put in its place (the <tbody> around a bare <tr>)
export interface AttributeStaticBinding {
	readonly type: typeof BINDING.ATTRIBUTE;
	readonly elementName: string;
	readonly nameParts: ReadonlyArray<Part>;
	readonly valueParts: ReadonlyArray<Part>;
}

export interface DynamicAttributeStaticBinding {
	readonly type: typeof BINDING.DYNAMIC_ATTRIBUTE;
	readonly elementName: string;
	readonly valueIndex: number;
}

export interface ContentStaticBinding {
	readonly type: typeof BINDING.CONTENT;
	readonly valueIndex: number;
	readonly closeMarkerData: string;
}

export interface RawContentStaticBinding {
	readonly type: typeof BINDING.RAW_CONTENT;
	readonly elementName: string;
	readonly parts: ReadonlyArray<Part>;
	readonly compiledStyleSheet: CompiledStyleSheet | typeof STYLE_SHEET_NOT_COMPILED;
}

export interface CommentStaticBinding {
	readonly type: typeof BINDING.COMMENT;
	readonly parts: ReadonlyArray<Part>;
}

//valueIndices point into the outer template's values
export interface TemplateContentStaticBinding {
	readonly type: typeof BINDING.TEMPLATE_CONTENT;
	readonly elementName: string;
	readonly content: ParsedTemplate;
	readonly valueIndices: ReadonlyArray<number>;
}

export type StaticBinding =
	| TagStaticBinding
	| AttributeStaticBinding
	| DynamicAttributeStaticBinding
	| ContentStaticBinding
	| RawContentStaticBinding
	| CommentStaticBinding
	| TemplateContentStaticBinding;

export interface ParsedTemplate {
	readonly htmlWithMarkers: string;
	readonly bindings: ReadonlyArray<StaticBinding>;
	readonly templateHash: number;
	readonly hostBindingCount: number;
	readonly hasStyleSheetBinding: boolean;
	readonly keyValueParts: ReadonlyArray<Part> | typeof NO_KEY;
}
