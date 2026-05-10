import { HTMLTemplate } from "./rendering/template-html";

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProperty(name: string, value: unknown): void;
}

export type ComponentOptions = ShadowRootInit;

export type RenderFunction = (element: BaseComponent) => HTMLTemplate;

export type ComponentGenerator = (
	element: BaseComponent,
) => Generator | AsyncGenerator;

export type ComponentConstructor = new () => BaseComponent;
