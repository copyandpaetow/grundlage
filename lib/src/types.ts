import { HTMLTemplate } from "./rendering/template-html";

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProperty(name: string, value: unknown): void;
}

export type ComponentOptions = ShadowRootInit;

export type Props = Record<string, unknown>;

export type TemplateRenderer<P extends Props = Props> = (
	props: P,
) => HTMLTemplate;

export type GeneratorFn<P extends Props = Props> = (
	initialProps: P,
	context: BaseComponent,
) => Generator;

export type Component = <P extends Props>(
	name: string,
	generatorFunction: GeneratorFn<P>,
	options?: ComponentOptions,
) => TemplateRenderer;
