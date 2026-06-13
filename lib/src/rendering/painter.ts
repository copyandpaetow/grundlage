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

/*
the Painter is the leaf capability: DOM commit and nothing else. it holds no reference to the
generator lifetime or the scheduler — those layers point DOWN at it (Scheduler → Producer → Painter),
never up. that one-directional edge is what lets the painted template outlive a generator restart: a
reconnect keeps the Painter to patch in place while Producer is rebuilt fresh.
*/

export interface Painter {
	host: BaseComponent;
	renderedTemplate: HTMLTemplate | null;
	//installed by the element in connectedCallback; the painter holds the reference so paint() can
	//bracket it and teardownPainter can stop it. `| null` (not optional) keeps the object shape fixed
	//from createPainter, so assigning the observer later is a value write, not a hidden-class transition
	attributeObserver: MutationObserver | null;
	//true on the first render after construction when an SSR shadow root was already attached;
	//flips false after the hydrate pass
	hydratePending: boolean;
}

export const createPainter = (host: BaseComponent, hydratePending: boolean): Painter => ({
	host,
	renderedTemplate: null,
	attributeObserver: null,
	hydratePending,
});

//patch in place on a template-shape match, else replace; hydrate once on the first SSR paint. brackets
//the host-attribute observer only when this render could write the host, so root-templateless components pay nothing
export const paint = (painter: Painter, value: HTMLTemplate): void => {
	const template = isTemplate(value) ? value : html`${value}`;
	const previous = painter.renderedTemplate;
	const touchesHost =
		template.parsedHTML.hostBindingOffset > 0 ||
		(previous?.parsedHTML.hostBindingOffset ?? 0) > 0;

	if (touchesHost) painter.attributeObserver?.disconnect();
	try {
		if (previous && previous.parsedHTML.templateHash === template.parsedHTML.templateHash) {
			updateTemplate(previous, template.currentExpressions);
			return;
		}
		painter.renderedTemplate = template;
		if (painter.hydratePending) {
			hydrateTemplate(template, painter.host);
			painter.hydratePending = false;
		} else {
			if (previous) clearHostAttributes(previous, painter.host);
			painter.host.shadowRoot?.replaceChildren(setupTemplate(template, painter.host));
		}
	} finally {
		if (touchesHost) painter.attributeObserver?.observe(painter.host, { attributes: true });
	}
};

//the server's one-shot DOM commit: hydrate an existing SSR shadow root, else produce from scratch,
//then drain the load() buffer. the SECOND pure DOM commit beside paint() — both take only (painter,
//value) and read no lifetime state. the one-shot concerns (the `done` latch, cancelling both task
//layers after this paint) live in producer' serverCommit, not here, so this stays a leaf like paint
export const serverPaint = (painter: Painter, value: HTMLTemplate): void => {
	const template = isTemplate(value) ? value : html`${value}`;
	if (painter.host.shadowRoot?.firstChild) {
		hydrateTemplate(template, painter.host);
	} else {
		painter.host.shadowRoot?.replaceChildren(setupTemplate(template, painter.host));
	}
	flushHostPayload(painter.host);
};

//release: stop the observer. the element installed it, but the painter owns the reference for its
//lifetime, so teardown lives here rather than inlined at the disconnect call site
export const teardownPainter = (painter: Painter): void => {
	painter.attributeObserver?.disconnect();
};
