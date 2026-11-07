import { expect, test } from "vitest";
import { component, html } from "../../../index";
import { BaseComponent } from "../../../types";

//only a real DOM refuses names; happy-dom accepts most of them
const isRealBrowser = typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

let tagIndex = 0;
const errorOfPainting = async (paint: () => unknown): Promise<unknown> => {
	const tag = `invalid-name-${tagIndex++}`;
	customElements.define(
		tag,
		component(function* () {
			yield function* view() {
				yield paint() as ReturnType<typeof html>;
			};
		}),
	);
	const errors: Array<unknown> = [];
	const recordError = (event: Event) => {
		event.preventDefault();
		errors.push((event as Event & { error: unknown }).error);
	};
	document.addEventListener("grundlage-error", recordError);
	const host = document.createElement(tag) as BaseComponent;
	document.body.append(host);
	await Promise.race([host.update(), new Promise((resolve) => setTimeout(resolve, 200))]);
	host.remove();
	document.removeEventListener("grundlage-error", recordError);
	return errors[0];
};

test.runIf(isRealBrowser)("a dynamic tag that composes no valid name names the fix", async () => {
	const error = await errorOfPainting(() => html`<${"my box"}>x</${"my box"}>`);
	expect(String(error)).toMatch(
		/grundlage: a dynamic tag .* "my box", which is not a valid tag name/,
	);
});

test.runIf(isRealBrowser)(
	"an attribute name that composes no valid name names the fix",
	async () => {
		const error = await errorOfPainting(() => html`<div data-${"a b"}="x"></div>`);
		expect(String(error)).toMatch(/grundlage: a binding composed the attribute name "data-a b"/);
	},
);

test.runIf(isRealBrowser)("a spread key that is no valid name names the fix", async () => {
	const error = await errorOfPainting(() => html`<div ${{ "a b": "x" }}></div>`);
	expect(String(error)).toMatch(/grundlage: a binding composed the attribute name "a b"/);
});
