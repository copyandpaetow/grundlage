import { expect, test } from "vitest";
import { component, html, prop } from "../index";

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

//happy-dom has no form-associated elements, so this needs a real browser
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

test.skipIf(!isRealBrowser)(
	"an unreflected value restores from the markup on form reset",
	async () => {
		const ratingInputProps = {
			value: prop.unreflected(prop.attribute(Number, 0)),
			open: prop.attribute(Boolean),
		};
		const tag = `rating-input-${Date.now()}`;
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					const resetToMarkup = () =>
						(host.value = prop.read(host, ratingInputProps).value);
					yield function* view({ value }) {
						host.internals?.setFormValue(String(value));
						yield html`<template on-form-reset=${resetToMarkup}
							><p>${value}</p></template
						>`;
					};
				},
				{ props: ratingInputProps, formAssociated: true },
			),
		);
		const form = document.createElement("form");
		form.innerHTML = `<${tag} name="rating" value="3"></${tag}>`;
		document.body.append(form);
		await sleep();
		const input = form.firstElementChild as HTMLElement & {
			value: number;
			open: boolean;
		};

		input.value = 4;
		input.open = true;
		await sleep();
		expect(input.getAttribute("value")).toBe("3");
		expect(input.getAttribute("open")).toBe("");
		expect(new FormData(form).get("rating")).toBe("4");

		form.reset();
		await sleep();
		expect(input.value).toBe(3);
		expect(input.shadowRoot!.textContent).toBe("3");
		expect(new FormData(form).get("rating")).toBe("3");
		form.remove();
	},
);
