import { HTMLTemplate } from "./rendering/template-html";

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProperty(name: string, value: unknown): void;
}

export type ComponentOptions = {};

export type Props = Record<string, unknown>;

export type GeneratorFn = (
	initialProps: Props,
	context: BaseComponent
) => Generator;

export type TemplateRenderer = (props: Props) => HTMLTemplate;

export type ComponentProps<Props = Record<string, unknown>> = (
	name: string,
	generatorFunction: GeneratorFn,
	options?: ComponentOptions
) => (props?: Props) => HTMLTemplate;
