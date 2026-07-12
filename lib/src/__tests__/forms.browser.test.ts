import { describe, expect, test } from "vitest";
import { FORM_EVENTS, type FormBase } from "../forms";
import { html, component } from "../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

// the real form-association round-trip needs attachInternals + live form behavior.
// the browser-as-dom project runs this file under happy-dom, which has neither, so
// skip there and let the chromium project carry the coverage.
const hasInternals =
	typeof HTMLElement.prototype.attachInternals === "function";

let tagId = 0;
const uniqueTag = () => `browser-field-${tagId++}-${Date.now()}`;

const formOptions = { mode: "open", formAssociated: true } as const;

const mountInForm = (tag: string) => {
	const form = document.createElement("form");
	const field = document.createElement(tag) as FormBase;
	form.appendChild(field);
	document.body.appendChild(form);
	return { form, field };
};

describe("form-associated component in a live form", () => {
	test.skipIf(!hasInternals)(
		"attachInternals populates host.internals",
		async () => {
			const tag = uniqueTag();
			let captured: ElementInternals | null | undefined;
			customElements.define(
				tag,
				component(function* (host) {
					captured = host.internals;
					yield () => html`<template><input /></template>`;
				}, formOptions),
			);

			const field = document.createElement(tag);
			document.body.appendChild(field);
			await sleep();

			expect(captured).toBeInstanceOf(ElementInternals);

			field.remove();
		},
	);

	test.skipIf(!hasInternals)(
		"setFormValue surfaces under the element's name in FormData",
		async () => {
			const tag = uniqueTag();
			customElements.define(
				tag,
				component(function* (host) {
					host.internals?.setFormValue("ada");
					yield () => html`<template><input /></template>`;
				}, formOptions),
			);

			const { form, field } = mountInForm(tag);
			field.setAttribute("name", "nickname");
			await sleep();

			expect(new FormData(form).get("nickname")).toBe("ada");

			form.remove();
		},
	);

	test.skipIf(!hasInternals)(
		"form.reset() broadcasts form-reset on the host",
		async () => {
			const tag = uniqueTag();
			customElements.define(
				tag,
				component(function* () {
					yield () => html`<template><input /></template>`;
				}, formOptions),
			);

			const { form, field } = mountInForm(tag);
			await sleep();

			let resets = 0;
			field.addEventListener(FORM_EVENTS.reset, () => resets++);
			form.reset();

			expect(resets).toBe(1);

			form.remove();
		},
	);

	test.skipIf(!hasInternals)(
		"disabling a wrapping fieldset broadcasts form-disabled",
		async () => {
			const tag = uniqueTag();
			customElements.define(
				tag,
				component(function* () {
					yield () => html`<template><input /></template>`;
				}, formOptions),
			);

			const form = document.createElement("form");
			const fieldset = document.createElement("fieldset");
			const field = document.createElement(tag) as FormBase;
			fieldset.appendChild(field);
			form.appendChild(fieldset);
			document.body.appendChild(form);
			await sleep();

			let disabled: boolean | null = null;
			field.addEventListener(FORM_EVENTS.disabled, (event) => {
				disabled = (event as CustomEvent<{ disabled: boolean }>).detail
					.disabled;
			});
			fieldset.disabled = true;
			await sleep();

			expect(disabled).toBe(true);

			form.remove();
		},
	);
});
