import { BINDING } from "./constants";

export type Part = string | number;

export interface DynamicDeclaration {
	rulePath: Array<number>;
	propertyName: string;
	priority: string;
	valueParts: Array<Part>;
}

export interface RuleCountCheck {
	rulePath: Array<number>;
	expectedRuleCount: number;
}

export interface CompiledStyleSheet {
	dynamicDeclarations: Array<DynamicDeclaration>;
	ruleCountChecks: Array<RuleCountCheck>;
}

export interface TagStaticBinding {
	type: typeof BINDING.TAG;
	parts: Array<Part>;
}

export interface AttributeStaticBinding {
	type: typeof BINDING.ATTRIBUTE;
	nameParts: Array<Part>;
	valueParts: Array<Part>;
}

export interface SingleValueAttributeStaticBinding {
	type: typeof BINDING.SINGLE_VALUE_ATTRIBUTE;
	nameParts: Array<Part>;
	valueIndex: number;
}

export interface DynamicAttributeStaticBinding {
	type: typeof BINDING.DYNAMIC_ATTRIBUTE;
	valueIndex: number;
}

export interface ContentStaticBinding {
	type: typeof BINDING.CONTENT;
	valueIndex: number;
	closeMarkerData: string;
}

export interface RawContentStaticBinding {
	type: typeof BINDING.RAW_CONTENT;
	parts: Array<Part>;
	compiledStyleSheet: CompiledStyleSheet | null;
}

export interface CommentStaticBinding {
	type: typeof BINDING.COMMENT;
	parts: Array<Part>;
}

export type StaticBinding =
	| TagStaticBinding
	| AttributeStaticBinding
	| SingleValueAttributeStaticBinding
	| DynamicAttributeStaticBinding
	| ContentStaticBinding
	| RawContentStaticBinding
	| CommentStaticBinding;

export interface ParsedTemplate {
	htmlWithMarkers: string;
	bindings: Array<StaticBinding>;
	templateHash: number;
	fragmentCloneSource: DocumentFragment | null;
	hostBindingCount: number;
	hasStyleSheetBinding: boolean;
	keyValueParts: Array<Part> | null;
}
