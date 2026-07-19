import { getParsedTemplate } from "../parser/html";
import { ParsedTemplate } from "../parser/types";
import { flushHostPayload, warnOnUnclaimedSsrPayloads } from "../load";
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
	releaseInstance,
} from "../rendering/instance";
import { Carrier } from "../rendering/bindings/types";
import { ValueOf } from "../utils/types";

export interface Painter {
	shadowRoot: ShadowRoot;
	carrier: Carrier;
	instance: Instance | null;
	attributeObserver: MutationObserver | null;
	isHydrationPending: boolean;
}

export const PAINT_MODE = { HYDRATE: 0, FRESH: 1 } as const;
type PaintMode = ValueOf<typeof PAINT_MODE>;

export const createPainter = (
	host: BaseComponent,
	shadowRoot: ShadowRoot,
	mode: PaintMode,
): Painter => ({
	shadowRoot,
	carrier: { host, hostStyleIsBound: false, styleSheetMountCounts: null },
	instance: null,
	attributeObserver: null,
	isHydrationPending: mode === PAINT_MODE.HYDRATE,
});

export const revertAllHostBindings = (painter: Painter): void => {
	const instance = painter.instance;
	if (instance === null) return;
	const liveBindings = instance.liveBindings;
	for (let index = 0; index < instance.parsed.hostBindingCount; index++)
		revertHostBinding(liveBindings[index]);
};

const paintRoot = (
	painter: Painter,
	value: TemplateValue,
	parsed: ParsedTemplate,
): void => {
	painter.carrier.hostStyleIsBound = parsed.hostStyleIsBound;
	const mounted = reconcileInstance(painter.instance, value, painter.carrier);
	if (mounted === null) return;
	if (painter.instance !== null) releaseInstance(painter.instance);
	revertAllHostBindings(painter);
	for (let index = 0; index < parsed.hostBindingCount; index++) {
		const live = createLiveBinding(
			parsed.bindings[index],
			painter.carrier.host,
		);
		commitLiveBinding(mounted.instance, live, value.values);
		mounted.instance.liveBindings[index] = live;
	}
	painter.shadowRoot.replaceChildren(mounted.fragment);
	painter.instance = mounted.instance;
};

const hydrateRoot = (
	painter: Painter,
	value: TemplateValue,
	parsed: ParsedTemplate,
): void => {
	painter.carrier.hostStyleIsBound = parsed.hostStyleIsBound;
	const instance = hydrateInstance(value, painter.shadowRoot, painter.carrier);

	for (let index = 0; index < parsed.hostBindingCount; index++) {
		const live = createLiveBinding(
			parsed.bindings[index],
			painter.carrier.host,
		);
		commitLiveBinding(instance, live, value.values);
		instance.liveBindings[index] = live;
	}
	painter.instance = instance;
};

export const paint = (painter: Painter, value: unknown): void => {
	const templateValue = coerceToTemplate(value);
	const parsed = getParsedTemplate(templateValue.__templateStrings);

	painter.attributeObserver?.disconnect();
	try {
		if (painter.isHydrationPending) {
			hydrateRoot(painter, templateValue, parsed);
			painter.isHydrationPending = false;
			warnOnUnclaimedSsrPayloads(painter.shadowRoot);
		} else {
			paintRoot(painter, templateValue, parsed);
		}
	} finally {
		painter.attributeObserver?.observe(painter.carrier.host, {
			attributes: true,
		});
	}
};

export const serverPaint = (painter: Painter, value: unknown): void => {
	const templateValue = coerceToTemplate(value);
	paintRoot(
		painter,
		templateValue,
		getParsedTemplate(templateValue.__templateStrings),
	);
	flushHostPayload(painter.carrier.host);
};

export const setupAttributeObserver = (
	painter: Painter,
	onChange: () => void,
): void => {
	painter.attributeObserver?.disconnect();
	const observer = new MutationObserver(onChange);
	observer.observe(painter.carrier.host, { attributes: true });
	painter.attributeObserver = observer;
};

export const teardownAttributeObserver = (painter: Painter): void => {
	painter.attributeObserver?.disconnect();
};

export const teardownPainter = (painter: Painter): void => {
	teardownAttributeObserver(painter);
};
