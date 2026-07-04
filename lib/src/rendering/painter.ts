import { getParsedTemplate } from "../parser/html";
import { flushHostPayload } from "../loader/load";
import { coerceToTemplate, TemplateValue } from "../template-value";
import { BaseComponent } from "../types";
import {
	commitLiveBinding,
	createLiveBinding,
	revertHostBinding,
} from "./commit";
import { Instance, reconcileInstance } from "./instance";
import { hydrateInstance } from "./mount-hydrate";

export interface Painter {
	host: BaseComponent;
	shadowRoot: ShadowRoot;
	instance: Instance | null;
	attributeObserver: MutationObserver | null;
	hydratePending: boolean;
	hostBindingCount: number;
}

export const createPainter = (
	host: BaseComponent,
	shadowRoot: ShadowRoot,
	hydratePending: boolean,
): Painter => ({
	host,
	shadowRoot,
	instance: null,
	attributeObserver: null,
	hydratePending,
	hostBindingCount: 0,
});

const clearShadowRoot = (painter: Painter): void => {
	const instance = painter.instance;
	if (instance === null) return;
	const liveBindings = instance.liveBindings;
	for (let index = 0; index < painter.hostBindingCount; index++)
		revertHostBinding(liveBindings[index]);
};

const paintRoot = (painter: Painter, value: TemplateValue): void => {
	const mounted = reconcileInstance(painter.instance, value);
	if (mounted === null) return;
	clearShadowRoot(painter);
	const parsed = getParsedTemplate(value.__templateStrings);
	for (let index = 0; index < parsed.hostBindingCount; index++) {
		const live = createLiveBinding(parsed.bindings[index], null, painter.host);
		commitLiveBinding(live, value.values);
		mounted.instance.liveBindings[index] = live;
	}
	painter.shadowRoot.replaceChildren(mounted.fragment);
	painter.instance = mounted.instance;
	painter.hostBindingCount = parsed.hostBindingCount;
};

const hydrateRoot = (painter: Painter, value: TemplateValue): void => {
	const parsed = getParsedTemplate(value.__templateStrings);
	const instance = hydrateInstance(value, painter.shadowRoot, null);
	for (let index = 0; index < parsed.hostBindingCount; index++) {
		const live = createLiveBinding(parsed.bindings[index], null, painter.host);
		commitLiveBinding(live, value.values);
		instance.liveBindings[index] = live;
	}
	painter.instance = instance;
	painter.hostBindingCount = parsed.hostBindingCount;
};

export const paint = (painter: Painter, value: unknown): void => {
	const templateValue = coerceToTemplate(value);
	const parsed = getParsedTemplate(templateValue.__templateStrings);
	const touchesHost =
		parsed.hostBindingCount > 0 || painter.hostBindingCount > 0;
	if (touchesHost) painter.attributeObserver?.disconnect();
	try {
		if (painter.hydratePending) {
			hydrateRoot(painter, templateValue);
			painter.hydratePending = false;
		} else {
			paintRoot(painter, templateValue);
		}
	} finally {
		if (touchesHost)
			painter.attributeObserver?.observe(painter.host, { attributes: true });
	}
};

export const serverPaint = (painter: Painter, value: unknown): void => {
	paintRoot(painter, coerceToTemplate(value));
	flushHostPayload(painter.host);
};

export const teardownPainter = (painter: Painter): void => {
	painter.attributeObserver?.disconnect();
};
