import { NO_KEY } from "./constants";
import * as BINDING from "./binding";

export type Part = string | number;

export interface TagStaticBinding {
	readonly type: typeof BINDING.TAG;
	readonly parts: ReadonlyArray<Part>;
}

//elementName is the tag as written, lowercased, so a fragment check can tell the bound element from
//one the HTML parser put in its place (the <tbody> around a bare <tr>)
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
	readonly keyValueParts: ReadonlyArray<Part> | typeof NO_KEY;
}
