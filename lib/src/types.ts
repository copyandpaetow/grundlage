import { TemplateValue } from "./template";

declare const templateMarker: unique symbol;

export interface Template {
	readonly [templateMarker]: never;
}

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProp(name: string, value: unknown, oldValue?: unknown): void;
	internals?: ElementInternals | null;
}

export type ComponentOptions = ShadowRootInit & {
	formAssociated?: boolean;
};

export type RenderFunction = (element: BaseComponent) => TemplateValue;

export type ComponentGenerator = (
	element: BaseComponent,
) => Generator | AsyncGenerator;

export type ComponentConstructor = new () => BaseComponent;
