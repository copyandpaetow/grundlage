import { HTMLTemplate } from "./rendering/template-html";

declare const templateMarker: unique symbol;

export interface Template {
	readonly [templateMarker]: never;
}

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProperty(name: string, value: unknown): void;
	internals?: ElementInternals | null;
}

export type ComponentOptions = ShadowRootInit & {
	formAssociated?: boolean;
};

export type RenderFunction = (element: BaseComponent) => HTMLTemplate;

export type ComponentGenerator = (
	element: BaseComponent,
) => Generator | AsyncGenerator;

export type ComponentConstructor = new () => BaseComponent;
