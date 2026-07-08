import { describe, expect, test, vi } from "vitest";
import { FORM_EVENTS, FormBase } from "../forms";
import { html, render } from "../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = (prefix: string) => `${prefix}-${tagId++}-${Date.now()}`;

// custom elements can't be `new`-ed in happy-dom until the tag is registered, so every
// FormBase instance goes through a freshly-defined element
const makeField = () => {
	const tag = uniqueTag("direct-field");
	customElements.define(tag, class extends FormBase {});
	return document.createElement(tag) as FormBase;
};

describe("FormBase - static surface", () => {
	test("declares itself form-associated for the upgrade-time read", () => {
		expect(FormBase.formAssociated).toBe(true);
	});

	test("the four lifecycle callbacks map onto the public event names", () => {
		// the callbacks are the only surface the browser calls; FORM_EVENTS is the
		// only surface users listen on. one missing pair means a dead lifecycle hook.
		const field = makeField();
		expect(typeof field.formAssociatedCallback).toBe("function");
		expect(typeof field.formDisabledCallback).toBe("function");
		expect(typeof field.formResetCallback).toBe("function");
		expect(typeof field.formStateRestoreCallback).toBe("function");
		expect(Object.values(FORM_EVENTS)).toEqual([
			"form-associated",
			"form-disabled",
			"form-reset",
			"form-state-restore",
		]);
	});

	test("attachInternals guard never throws and leaves internals null-or-object", () => {
		// happy-dom has no attachInternals, so the guard must keep construction
		// alive on the server. internals is null here; a live browser fills it in.
		const field = makeField();
		expect(
			field.internals === null || typeof field.internals === "object",
		).toBe(true);
	});
});

describe("FormBase - lifecycle callbacks re-broadcast as events", () => {
	test("formAssociatedCallback carries the form in detail", () => {
		const field = makeField();
		const form = document.createElement("form");
		let received: CustomEvent<{ form: HTMLFormElement | null }> | null = null;
		field.addEventListener(FORM_EVENTS.associated, (event) => {
			received = event as CustomEvent<{ form: HTMLFormElement | null }>;
		});

		field.formAssociatedCallback(form);

		expect(received!.detail.form).toBe(form);
	});

	test("formDisabledCallback carries the disabled flag in detail", () => {
		const field = makeField();
		let received: CustomEvent<{ disabled: boolean }> | null = null;
		field.addEventListener(FORM_EVENTS.disabled, (event) => {
			received = event as CustomEvent<{ disabled: boolean }>;
		});

		field.formDisabledCallback(true);

		expect(received!.detail.disabled).toBe(true);
	});

	test("formResetCallback fires a plain payloadless Event", () => {
		const field = makeField();
		let received: Event | null = null;
		field.addEventListener(FORM_EVENTS.reset, (event) => {
			received = event;
		});

		field.formResetCallback();

		expect(received).toBeInstanceOf(Event);
		// the reset event deliberately skips CustomEvent to avoid the detail allocation
		expect(received).not.toBeInstanceOf(CustomEvent);
	});

	test("formStateRestoreCallback carries state and mode in detail", () => {
		const field = makeField();
		let received: CustomEvent<{ state: unknown; mode: string }> | null = null;
		field.addEventListener(FORM_EVENTS.restore, (event) => {
			received = event as CustomEvent<{ state: unknown; mode: string }>;
		});

		field.formStateRestoreCallback("draft", "restore");

		expect(received!.detail.state).toBe("draft");
		expect(received!.detail.mode).toBe("restore");
	});

	test("the broadcast events do not bubble", () => {
		// listeners attach to the host itself; bubbling would leak form lifecycle
		// into ancestors that never opted in.
		const field = makeField();
		let bubbles = true;
		field.addEventListener(FORM_EVENTS.reset, (event) => {
			bubbles = event.bubbles;
		});

		field.formResetCallback();

		expect(bubbles).toBe(false);
	});
});

describe("render(..., { formAssociated }) parent selection", () => {
	// formAssociated replaces the default options, so a full ShadowRootInit comes with it
	const formOptions = { mode: "open", formAssociated: true } as const;

	test("opting in inherits FormBase and its static flag", () => {
		const tag = uniqueTag("opt-in");
		const Element = render(function* () {
			yield () => html`<p>field</p>`;
		}, formOptions);
		customElements.define(tag, Element);

		expect(
			(Element as unknown as { formAssociated?: boolean }).formAssociated,
		).toBe(true);
		expect(document.createElement(tag)).toBeInstanceOf(FormBase);
	});

	test("the default component is a plain element, never form-associated", () => {
		const tag = uniqueTag("plain");
		const Element = render(function* () {
			yield () => html`<p>field</p>`;
		});
		customElements.define(tag, Element);

		expect(
			(Element as unknown as { formAssociated?: boolean }).formAssociated,
		).toBeUndefined();
		expect(document.createElement(tag)).not.toBeInstanceOf(FormBase);
	});

	test("a declared on-form-reset listener runs when the host resets", async () => {
		// the end-to-end wiring: FormBase re-broadcasts formResetCallback, and the
		// root-template `on-form-reset` mirror binds the handler onto the host.
		const tag = uniqueTag("form-field");
		const onReset = vi.fn();
		const Element = render(function* () {
			yield () => html`
				<template on-form-reset="${onReset}"><input /></template>
			`;
		}, formOptions);
		customElements.define(tag, Element);

		const field = document.createElement(tag) as FormBase;
		document.body.appendChild(field);
		await sleep();

		field.formResetCallback();
		expect(onReset).toHaveBeenCalledTimes(1);

		field.remove();
	});
});
