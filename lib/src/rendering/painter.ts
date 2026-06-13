import { html } from "../parser/html";
import { flushHostPayload } from "../loader/load";
import { BaseComponent } from "../types";
import {
	clearHostAttributes,
	HTMLTemplate,
	hydrateTemplate,
	isTemplate,
	setupTemplate,
	updateTemplate,
} from "./template-html";

export interface Painter {
	host: BaseComponent;
	renderedTemplate: HTMLTemplate | null;
	attributeObserver: MutationObserver | null;
	hydratePending: boolean;
}

export const createPainter = (
	host: BaseComponent,
	hydratePending: boolean,
): Painter => ({
	host,
	renderedTemplate: null,
	attributeObserver: null,
	hydratePending,
});

export const paint = (painter: Painter, value: HTMLTemplate): void => {
	const template = isTemplate(value) ? value : html`${value}`;
	const previous = painter.renderedTemplate;
	const touchesHost =
		template.parsedHTML.hostBindingOffset > 0 ||
		(previous?.parsedHTML.hostBindingOffset ?? 0) > 0;

	if (touchesHost) painter.attributeObserver?.disconnect();
	try {
		if (
			previous &&
			previous.parsedHTML.templateHash === template.parsedHTML.templateHash
		) {
			updateTemplate(previous, template.currentExpressions);
			return;
		}
		painter.renderedTemplate = template;
		if (painter.hydratePending) {
			hydrateTemplate(template, painter.host);
			painter.hydratePending = false;
		} else {
			if (previous) clearHostAttributes(previous, painter.host);
			painter.host.shadowRoot?.replaceChildren(
				setupTemplate(template, painter.host),
			);
		}
	} finally {
		if (touchesHost)
			painter.attributeObserver?.observe(painter.host, { attributes: true });
	}
};

export const serverPaint = (painter: Painter, value: HTMLTemplate): void => {
	const template = isTemplate(value) ? value : html`${value}`;
	if (painter.host.shadowRoot?.firstChild) {
		hydrateTemplate(template, painter.host);
	} else {
		painter.host.shadowRoot?.replaceChildren(
			setupTemplate(template, painter.host),
		);
	}
	flushHostPayload(painter.host);
};

export const teardownPainter = (painter: Painter): void => {
	painter.attributeObserver?.disconnect();
};
