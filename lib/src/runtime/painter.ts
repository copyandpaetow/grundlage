import { getParsedTemplate } from "../parser/html";
import { ParsedTemplate } from "../parser/types";
import { flushHostPayload, warnOnUnclaimedReplay } from "../load";
import { coerceToTemplate, TemplateValue } from "../template";
import { BaseComponent } from "../types";
import {
	commitLiveBinding,
	createLiveBinding,
	revertHostBinding,
} from "../rendering/bindings/dispatch";
import {
	hydrateInstance,
	Instance,
	reconcileInstance,
} from "../rendering/instance";
import { Carrier } from "../rendering/bindings/types";

export interface Painter {
	host: BaseComponent;
	shadowRoot: ShadowRoot;
	carrier: Carrier;
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
	carrier: { host, hostStyleIsBound: false, cssPlanMountCounts: null },
	instance: null,
	attributeObserver: null,
	hydratePending,
	hostBindingCount: 0,
});

const revertHostBindings = (painter: Painter): void => {
	const instance = painter.instance;
	if (instance === null) return;
	const liveBindings = instance.liveBindings;
	for (let index = 0; index < painter.hostBindingCount; index++)
		revertHostBinding(liveBindings[index]);
};

const paintRoot = (
	painter: Painter,
	value: TemplateValue,
	parsed: ParsedTemplate,
): void => {
	//a root-template change remounts every live binding, so updating in place is safe
	painter.carrier.hostStyleIsBound = parsed.hostStyleIsBound;
	const mounted = reconcileInstance(painter.instance, value, painter.carrier);
	if (mounted === null) return;
	revertHostBindings(painter);
	for (let index = 0; index < parsed.hostBindingCount; index++) {
		const live = createLiveBinding(parsed.bindings[index], null, painter.host);
		commitLiveBinding(live, value.values);
		mounted.instance.liveBindings[index] = live;
	}
	painter.shadowRoot.replaceChildren(mounted.fragment);
	painter.instance = mounted.instance;
	painter.hostBindingCount = parsed.hostBindingCount;
};

const hydrateRoot = (
	painter: Painter,
	value: TemplateValue,
	parsed: ParsedTemplate,
): void => {
	painter.carrier.hostStyleIsBound = parsed.hostStyleIsBound;
	const instance = hydrateInstance(value, painter.shadowRoot, painter.carrier);
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
	//any paint may write the host (host bindings, css host props from nested templates
	//the root can't know statically); disconnect() also drops queued self-write records
	painter.attributeObserver?.disconnect();
	try {
		if (painter.hydratePending) {
			hydrateRoot(painter, templateValue, parsed);
			painter.hydratePending = false;
			warnOnUnclaimedReplay(painter.shadowRoot);
		} else {
			paintRoot(painter, templateValue, parsed);
		}
	} finally {
		painter.attributeObserver?.observe(painter.host, { attributes: true });
	}
};

export const serverPaint = (painter: Painter, value: unknown): void => {
	const templateValue = coerceToTemplate(value);
	paintRoot(
		painter,
		templateValue,
		getParsedTemplate(templateValue.__templateStrings),
	);
	flushHostPayload(painter.host);
};

export const setupAttributeObserver = (
	painter: Painter,
	onChange: () => void,
): void => {
	painter.attributeObserver?.disconnect();
	const observer = new MutationObserver(onChange);
	observer.observe(painter.host, { attributes: true });
	painter.attributeObserver = observer;
};

export const teardownPainter = (painter: Painter): void => {
	painter.attributeObserver?.disconnect();
};
