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
	clonable?: boolean
};

//what a content position accepts: the same rulebook as a content hole, one level deep — array
//items are validated where they are committed, not here
export type ContentValue =
	| Template
	| TemplateValue
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| Array<ContentValue>;

export type RenderFunction = (
	element: BaseComponent,
) =>
	| ContentValue
	| ComponentGenerator
	| Promise<ContentValue | ComponentGenerator>;

export type ComponentGenerator = (
	element: BaseComponent,
) => Generator | AsyncGenerator;

export type ComponentConstructor = new () => BaseComponent;
