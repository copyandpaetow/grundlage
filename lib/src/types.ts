import { HTMLTemplate } from "./rendering/template-html";

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProperty(name: string, value: unknown): void;
	//present only on form-associated components (render(..., { formAssociated: true })). null on the server where attachInternals is unavailable
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
