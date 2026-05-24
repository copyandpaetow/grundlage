import { HTMLTemplate } from "./rendering/template-html";

declare const templateMarker: unique symbol;

/**
 * Opaque handle returned by {@link html}. Yield it from a component to render it,
 * or embed it inside another `html` template. Not constructible by hand.
 */
export interface Template {
	readonly [templateMarker]: never;
}

/** The host element passed to your generator. Call `update()` to re-run the component; `setProperty()` sets a value and re-renders. */
export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProperty(name: string, value: unknown): void;
	//present only on form-associated components (render(..., { formAssociated: true })). null on the server where attachInternals is unavailable
	internals?: ElementInternals | null;
}

/** Options for {@link render}. Extends `ShadowRootInit` (e.g. `{ mode: "open" }`); set `formAssociated` for components that participate in forms. */
export type ComponentOptions = ShadowRootInit & {
	formAssociated?: boolean;
};

export type RenderFunction = (element: BaseComponent) => HTMLTemplate;

export type ComponentGenerator = (
	element: BaseComponent,
) => Generator | AsyncGenerator;

export type ComponentConstructor = new () => BaseComponent;
