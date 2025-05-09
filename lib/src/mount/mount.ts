import type { Context } from "../context";
import {
	ASYNC_STATES,
	type InternalAsyncSignal,
	type SignalGetter,
	type ValueOf,
} from "../context/signal";
import { remove, requestIsomorphicAnimationFrame } from "./helper";
import { updateDOM } from "./update-dom";

const extractSpecialTemplates = (
	template: HTMLTemplateElement,
	type: "fallback" | "error" | "empty" | "empty" | "loading"
) => {
	const fragment = document.createDocumentFragment();
	template.content.querySelectorAll(`[slot=${type}]`).forEach((slotted) => {
		fragment.append(slotted);
	});

	return fragment;
};

export const defaultWhen = () => true;
export const noop = () => undefined;
export const defaultKeyFn = (
	element: unknown,
	index?: number,
	array?: Array<unknown>
) => `key-${element?.toString()}`;

export type MountData = {
	keyFn: (element: unknown, index?: number, array?: Array<unknown>) => string;
	when: (activeValue?: unknown) => unknown;
	each: (activeValue?: unknown) => Array<unknown>;
	suspense: ((activeValue?: unknown) => unknown) & InternalAsyncSignal;
	ref: (rangeOrElement: Range | Element) => void;
};

export type TemplateSlots = {
	content: DocumentFragment;
	fallbacks: DocumentFragment;
	errors: DocumentFragment;
	empty: DocumentFragment;
	loading: DocumentFragment;
};

const RENDER_CASE = {
	CONTENT: 0,
	FALLBACK: 1,
	EMPTY: 2,
	LOADING: 3,
	ERROR: 4,
} as const;

export const extractTemplateSlots = (
	originalTemplate: HTMLTemplateElement
): Record<ValueOf<typeof RENDER_CASE>, DocumentFragment> => {
	const template = originalTemplate.cloneNode(true) as HTMLTemplateElement;

	return {
		[RENDER_CASE.CONTENT]: template.content,
		[RENDER_CASE.FALLBACK]: extractSpecialTemplates(template, "fallback"),
		[RENDER_CASE.EMPTY]: extractSpecialTemplates(template, "empty"),
		[RENDER_CASE.LOADING]: extractSpecialTemplates(template, "loading"),
		[RENDER_CASE.ERROR]: extractSpecialTemplates(template, "error"),
	};
};

export const extractTemplateFunctionality = (
	template: HTMLTemplateElement,
	{ keyFn }: TemplateBus,
	{ values }: Context
): MountData => {
	return {
		when:
			(values.get(template.getAttribute("when")!) as MountData["when"]) ??
			defaultWhen,
		each:
			(values.get(template.getAttribute("each")!) as MountData["each"]) ?? noop,

		suspense:
			(values.get(
				template.getAttribute("suspense")!
			) as MountData["suspense"]) ?? noop,
		ref:
			(values.get(template.getAttribute("ref")!) as MountData["ref"]) ?? noop,
		keyFn:
			(values.get(template.getAttribute("keys")!) as MountData["keyFn"]) ??
			keyFn ??
			defaultKeyFn,
	};
};

export type MountPoint = [Comment, Comment];

export const createMountPoint = (
	template: Element,
	name = "template"
): MountPoint => {
	const start = new Comment(`${name}-start`);
	const end = new Comment(`${name}-end`);

	template.replaceWith(start, end);

	return [start, end];
};

export type TemplateBus = {
	activeValue: SignalGetter<unknown>;
	keyFn: (element: unknown, index?: number, array?: Array<unknown>) => string;
};

export const shouldRerender = (
	slots: Record<ValueOf<typeof RENDER_CASE>, DocumentFragment>,
	data: MountData,
	{ activeValue }: TemplateBus,
	context: Context
) => {
	const hasEmpty = slots[RENDER_CASE.EMPTY].childNodes.length;
	const hasError = slots[RENDER_CASE.ERROR].childNodes.length;
	const hasLoading = slots[RENDER_CASE.LOADING].childNodes.length;

	const [result, setResult] = context.signal.create<unknown>(undefined);
	let staticResult: unknown = undefined;

	const status = context.signal.computed(() => {
		try {
			const parentResult = activeValue();
			const whenResult = data.when(parentResult);
			const eachResult = data.each?.(parentResult);
			const status = data.suspense?.status?.();
			const error = data.suspense?.error?.();
			const suspenseResult = data.suspense?.(parentResult);

			staticResult = error ?? suspenseResult ?? eachResult ?? whenResult;
			setResult(staticResult);

			if (status === ASYNC_STATES.ERROR && hasError) {
				return RENDER_CASE.ERROR;
			}

			if (status === ASYNC_STATES.LOADING && hasLoading) {
				return RENDER_CASE.LOADING;
			}

			if (eachResult?.length === 0 && hasEmpty) {
				return RENDER_CASE.EMPTY;
			}

			if (!whenResult || (status && status !== ASYNC_STATES.SUCCESS)) {
				return RENDER_CASE.FALLBACK;
			}

			return RENDER_CASE.CONTENT;
		} catch (error) {
			return RENDER_CASE.ERROR;
		}
	});

	return { status, result, staticResult: () => staticResult };
};

export type ComponentLifecylce = {
	beforeRender: (activeValue: unknown) => void;
	afterRender: (activeValue: unknown) => void;
};

export const extractTemplateCallbacks = (
	templateElement: HTMLTemplateElement,
	context: Context
): ComponentLifecylce => {
	const lifecyle: ComponentLifecylce = {
		beforeRender: noop,
		afterRender: noop,
	};

	templateElement.getAttributeNames().forEach((attributeName) => {
		switch (attributeName.toLowerCase()) {
			case "beforerender":
				lifecyle.beforeRender = context.values.get(
					templateElement.getAttribute(attributeName)!
				) as ComponentLifecylce["beforeRender"];

				break;
			case "afterrender":
				lifecyle.afterRender = context.values.get(
					templateElement.getAttribute(attributeName)!
				) as ComponentLifecylce["beforeRender"];

				break;

			default:
				break;
		}
	});

	return lifecyle;
};

export const mount = (
	templateElement: HTMLTemplateElement,
	templateBus: TemplateBus,
	context: Context
) => {
	const { signal } = context;

	const templateData = extractTemplateFunctionality(
		templateElement,
		templateBus,
		context
	);
	const templateSlots = extractTemplateSlots(templateElement);
	const [start, end] = createMountPoint(templateElement);
	const { beforeRender, afterRender } = extractTemplateCallbacks(
		templateElement,
		context
	);

	const { result, status, staticResult } = shouldRerender(
		templateSlots,
		templateData,
		templateBus,
		context
	);

	signal.computed((isToplevelEffect) => {
		const currentResult = staticResult();

		const content = updateDOM(
			templateSlots[status()].cloneNode(true) as DocumentFragment,
			{ activeValue: result, keyFn: templateData.keyFn },
			context
		);

		if (isToplevelEffect) {
			beforeRender(currentResult);
			requestIsomorphicAnimationFrame(() => {
				remove(start, end);
				start.after(content);
				afterRender(currentResult);
			});
		} else {
			remove(start, end);
			start.after(content);
		}
	});
};
