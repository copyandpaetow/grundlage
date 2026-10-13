import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component } from "../index";

const canRun =
	typeof (Element.prototype as { setHTMLUnsafe?: unknown }).setHTMLUnsafe ===
	"function";

let tagId = 0;
const uniqueTag = () => `fatal-then-hydrate-${tagId++}-${Date.now()}`;

const prerenderOpen = (tag: string, shadowInner: string): HTMLElement => {
	const holder = document.createElement("div");
	document.body.appendChild(holder);
	(holder as unknown as { setHTMLUnsafe(html: string): void }).setHTMLUnsafe(
		`<${tag}><template shadowrootmode="open">${shadowInner}</template></${tag}>`,
	);
	return holder.firstElementChild as HTMLElement;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("a fatal error before the first paint ends the pending hydration", () => {
	test.skipIf(!canRun)(
		"re-inserting after the error mounts fresh, without a hydration mismatch warning",
		() => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.spyOn(console, "error").mockImplementation(() => {});
			const tag = uniqueTag();
			const host = prerenderOpen(tag, `<p>hi</p>`);

			let renderCallCount = 0;
			customElements.define(
				tag,
				component(function* () {
					renderCallCount++;
					if (renderCallCount === 1) throw new Error("first render fails");
					yield () => html`<p>${"recovered"}</p>`;
				}),
			);
			customElements.upgrade(host);
			expect(host.shadowRoot!.textContent).toContain("first render fails");

			//removal and re-insertion in one task is the way back from a fatal error
			const parent = host.parentElement!;
			host.remove();
			parent.appendChild(host);

			expect(host.shadowRoot!.querySelector("p")?.textContent).toBe(
				"recovered",
			);
			const hydrationWarnings = warn.mock.calls.filter(([message]) =>
				String(message).includes("hydration mismatch"),
			);
			expect(hydrationWarnings).toEqual([]);

			parent.remove();
		},
	);
});
