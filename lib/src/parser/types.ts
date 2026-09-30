import { BINDING, NO_KEY, STYLE_SHEET_NOT_COMPILED } from "./constants";

export type Part = string | number;

export interface DynamicDeclaration {
	readonly rulePath: ReadonlyArray<number>;
	readonly propertyName: string;
	readonly priority: string;
	readonly valueParts: ReadonlyArray<Part>;
}

export interface RuleCountCheck {
	readonly rulePath: ReadonlyArray<number>;
	readonly expectedRuleCount: number;
}

export interface CompiledStyleSheet {
	readonly dynamicDeclarations: ReadonlyArray<DynamicDeclaration>;
	readonly ruleCountChecks: ReadonlyArray<RuleCountCheck>;
}

export interface TagStaticBinding {
	readonly type: typeof BINDING.TAG;
	readonly parts: ReadonlyArray<Part>;
}

export interface AttributeStaticBinding {
	readonly type: typeof BINDING.ATTRIBUTE;
	readonly nameParts: ReadonlyArray<Part>;
	readonly valueParts: ReadonlyArray<Part>;
}

export interface DynamicAttributeStaticBinding {
	readonly type: typeof BINDING.DYNAMIC_ATTRIBUTE;
	readonly valueIndex: number;
}

export interface ContentStaticBinding {
	readonly type: typeof BINDING.CONTENT;
	readonly valueIndex: number;
	readonly closeMarkerData: string;
}

export interface RawContentStaticBinding {
	readonly type: typeof BINDING.RAW_CONTENT;
	readonly parts: ReadonlyArray<Part>;
	readonly compiledStyleSheet:
		CompiledStyleSheet | typeof STYLE_SHEET_NOT_COMPILED;
}

export interface CommentStaticBinding {
	readonly type: typeof BINDING.COMMENT;
	readonly parts: ReadonlyArray<Part>;
}

export type StaticBinding =
	| TagStaticBinding
	| AttributeStaticBinding
	| DynamicAttributeStaticBinding
	| ContentStaticBinding
	| RawContentStaticBinding
	| CommentStaticBinding;

export interface ParsedTemplate {
	readonly htmlWithMarkers: string;
	readonly bindings: ReadonlyArray<StaticBinding>;
	readonly templateHash: number;
	readonly hostBindingCount: number;
	readonly hasStyleSheetBinding: boolean;
	readonly keyValueParts: ReadonlyArray<Part> | typeof NO_KEY;
}
