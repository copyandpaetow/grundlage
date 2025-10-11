import { TemplateResult } from "./html/html";

export interface BaseComponent extends HTMLElement {
	setState<Value>(key: string, value: Value): Value;
	getState<Value>(key: string): Value;
	hasState(key: string): boolean;
}

export type AttrHole = {
	values: Array<number | string>;
	keys: Array<number | string>;
	start: Comment;
	dirty: boolean;
};

export type ContentHole = {
	values: number;
	start: Comment;
	end: Comment;
	dirty: boolean;
};

export type TagHole = {
	values: Array<number | string>;
	start: Comment;
	dirty: boolean;
};

export type Holes = {
	contentUpdates: Array<ContentHole>;
	attributeUpdates: Array<AttrHole>;
	tagUpdates: Array<TagHole>;
};

export type ComponentOptions = {};

export type Props = Record<string, unknown>;

export type RenderFn = (props: Props) => TemplateResult;

export type ComponentProps<Props = Record<string, unknown>> = (
	name: string,
	renderFn: RenderFn,
	options?: ComponentOptions
) => (props?: Props) => TemplateResult;
