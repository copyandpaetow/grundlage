import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

const sleep = (duration = 0) => new Promise((resolve) => setTimeout(resolve, duration));

//a platform claim a light-DOM mode rests on: a prelude-less @scope is inert inside a shadow root,
//and scopes to the parent element of its <style>
describe("prelude-less @scope", () => {
	let tagId = 0;
	const uniqueTag = () => `test-scope-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	//probes the exact shape the tests use — a scoped sheet inside a shadow root — because
	//happy-dom resolves a scoped sheet in the light DOM but returns "" for the same sheet in a
	//shadow tree, and a lighter probe would wave the visual tests through into a failure
	const detectScopedStyleResolution = () => {
		const probe = document.createElement("div");
		document.body.appendChild(probe);
		probe.attachShadow({ mode: "open" }).innerHTML =
			"<style>@scope { p { color: rgb(255, 0, 0); } }</style><p></p>";
		const resolved =
			getComputedStyle(probe.shadowRoot!.querySelector("p")!).color === "rgb(255, 0, 0)";
		probe.remove();
		return resolved;
	};
	const resolvesScopedStyles = detectScopedStyleResolution();

	test.skipIf(!resolvesScopedStyles)(
		"does not suppress its inner rules inside a shadow root",
		async () => {
			const scopedTag = uniqueTag();
			const unscopedTag = uniqueTag();

			const Scoped = component(function* () {
				yield function* () {
					yield html`<style>
							@scope {
								p {
									color: rgb(255, 0, 0);
								}
							}
						</style>
						<p>text</p>`;
				};
			});
			const Unscoped = component(function* () {
				yield function* () {
					yield html`<style>
							p {
								color: rgb(255, 0, 0);
							}
						</style>
						<p>text</p>`;
				};
			});

			customElements.define(scopedTag, Scoped);
			customElements.define(unscopedTag, Unscoped);
			const scopedElement = mount(scopedTag) as InstanceType<typeof Scoped>;
			const unscopedElement = mount(unscopedTag) as InstanceType<typeof Unscoped>;
			await sleep();

			const scopedParagraph = scopedElement.shadowRoot!.querySelector("p")!;
			const unscopedParagraph = unscopedElement.shadowRoot!.querySelector("p")!;

			expect(getComputedStyle(scopedParagraph).color).toBe(
				getComputedStyle(unscopedParagraph).color,
			);
			expect(getComputedStyle(scopedParagraph).color).toBe("rgb(255, 0, 0)");

			cleanup(scopedElement);
			cleanup(unscopedElement);
		},
	);

	//the scoping root of a prelude-less @scope is the parent element of the owning <style>, so a
	//<style> nested below the top level of the component root scopes to that wrapper rather than to
	//the component
	test.skipIf(!resolvesScopedStyles)(
		"scopes to the parent element of its own style element",
		async () => {
			const tag = uniqueTag();

			const MyElement = component(function* () {
				yield function* () {
					yield html`<div>
							<style>
								@scope {
									p {
										color: rgb(255, 0, 0);
									}
								}
							</style>
							<p id="inside">inside the wrapper</p>
						</div>
						<p id="outside">outside the wrapper</p>`;
				};
			});

			customElements.define(tag, MyElement);
			const element = mount(tag) as InstanceType<typeof MyElement>;
			await sleep();

			const inside = element.shadowRoot!.querySelector("#inside")!;
			const outside = element.shadowRoot!.querySelector("#outside")!;

			expect(getComputedStyle(inside).color).toBe("rgb(255, 0, 0)");
			expect(getComputedStyle(outside).color).not.toBe("rgb(255, 0, 0)");

			cleanup(element);
		},
	);

	test.skipIf(!resolvesScopedStyles)(
		"a scoped value hole reaches the rendered pixels",
		async () => {
			const tag = uniqueTag();
			let color = "rgb(255, 0, 0)";

			const MyElement = component(function* () {
				yield function* () {
					yield html`<style>
							@scope {
								p {
									color: ${color};
								}
							}
						</style>
						<p>text</p>`;
				};
			});

			customElements.define(tag, MyElement);
			const element = mount(tag) as InstanceType<typeof MyElement>;
			await sleep();

			const paragraph = element.shadowRoot!.querySelector("p")!;
			expect(getComputedStyle(paragraph).color).toBe("rgb(255, 0, 0)");

			color = "rgb(0, 0, 255)";
			await element.update();
			await sleep();

			expect(getComputedStyle(paragraph).color).toBe("rgb(0, 0, 255)");

			cleanup(element);
		},
	);
});
