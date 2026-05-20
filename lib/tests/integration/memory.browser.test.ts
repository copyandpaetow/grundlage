import { describe, expect, test } from "vitest";
import { html, render } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//we rely on the host runtime exposing global.gc — Chromium with `--expose-gc`, or node-with-vitest run with --expose-gc
//=> when it is missing we skip the leak assertions instead of producing flaky failures based on whatever heuristic GC happened to run
type GcHook = (() => void) | undefined;
const gc = (globalThis as unknown as { gc?: GcHook }).gc;

const tryCollect = async () => {
	if (!gc) return false;
	//we ask twice with a yield in between so any finalizer-queued cleanup also runs before we re-check
	gc();
	await sleep();
	gc();
	await sleep();
	return true;
};

describe.runIf(typeof gc === "function")("memory leak smoke tests", () => {
	let tagId = 0;
	const uniqueTag = () => `test-memory-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	test("removed list items become collectable after the list shrinks to empty", async () => {
		//we render a long list, capture WeakRefs to each item element, then shrink the list to empty
		//if the reconciler retained any item (closure, expression slot, dirty bookkeeping) the WeakRef would still resolve after gc()
		const tag = uniqueTag();
		let items = Array.from({ length: 50 }, (_, index) => `item-${index}`);

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((value) => html`<li>${value}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const liNodes = Array.from(element.shadowRoot!.querySelectorAll("li"));
		const liRefs = liNodes.map((node) => new WeakRef(node));
		//we null the strong references so only the WeakRefs remain
		liNodes.length = 0;

		items = [];
		await element.update();
		await sleep();

		const collected = await tryCollect();
		expect(collected).toBe(true);

		const stillReachable = liRefs.filter((ref) => ref.deref() !== undefined);
		expect(stillReachable.length).toBe(0);

		element.remove();
	});

	test("a disconnected component instance becomes collectable", async () => {
		//the whole BaseElement instance should be reachable only from document.body while mounted; after .remove() and the cleanup tick, the only retainer should be our local variable
		const tag = uniqueTag();

		const MyElement = render(function* () {
			yield () => html`<p>x</p>`;
		});
		customElements.define(tag, MyElement);

		let element: HTMLElement | null = mount(tag);
		await sleep();
		const ref = new WeakRef(element);

		element.remove();
		element = null;
		await sleep();

		const collected = await tryCollect();
		expect(collected).toBe(true);

		expect(ref.deref()).toBeUndefined();
	});

	test("repeated mount/unmount cycles do not retain prior instances", async () => {
		//if any global registry (cache, observer registration, listener) keeps a strong reference to the host element, this loop would leak one instance per cycle
		//we cap at a small N so the test stays fast; the asymmetry (we collect after the loop) is what surfaces the leak
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () => html`<p>cycle</p>`;
		});
		customElements.define(tag, MyElement);

		const refs: Array<WeakRef<HTMLElement>> = [];
		for (let cycleIndex = 0; cycleIndex < 10; cycleIndex++) {
			const element = mount(tag);
			await sleep();
			refs.push(new WeakRef(element));
			element.remove();
			await sleep();
		}

		const collected = await tryCollect();
		expect(collected).toBe(true);

		const alive = refs.filter((ref) => ref.deref() !== undefined);
		expect(alive.length).toBe(0);
	});
});
