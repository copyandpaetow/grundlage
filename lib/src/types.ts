import { BindingResult, TemplateResult } from "./html/html";

export interface BaseComponent extends HTMLElement {
	setState<Value>(key: string, value: Value): Value;
	getState<Value>(key: string): Value;
	hasState(key: string): boolean;
}

export type DynamicPart = BindingResult & {
	start: Comment;
	end: Comment;
};

export type ComponentOptions = {};

export type Props = Record<string, unknown>;

export type RenderFn = (props: Props) => TemplateResult;

export type ComponentProps<Props = Record<string, unknown>> = (
	name: string,
	renderFn: RenderFn,
	options?: ComponentOptions
) => (props?: Props) => TemplateResult;
