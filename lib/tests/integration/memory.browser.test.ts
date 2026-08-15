import { describe, expect, test } from "vitest";
import { html, component } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//the leak assertions need global.gc, which is Chromium with `--expose-gc` or vitest run the same
//way. Without it they skip rather than guess from whatever heuristic collection happened to run
type GcHook = (() => void) | undefined;
const gc = (globalThis as unknown as { gc?: GcHook }).gc;

const tryCollect = async () => {
	if (!gc) return false;
	//twice with a yield in between, so finalizer-queued cleanup runs before the re-check
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
		//a long list, one WeakRef per item element, then the list shrinks to empty
		//any item the reconciler retained — closure, expression slot, dirty bookkeeping — leaves its
		//WeakRef resolving after gc()
		const tag = uniqueTag();
		let items = Array.from({ length: 50 }, (_, index) => `item-${index}`);

		const MyElement = component(function* () {
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
		//nulled so only the WeakRefs remain
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
		//while mounted the instance is reachable only from document.body; after .remove() and the
		//cleanup tick the local variable is the last retainer
		const tag = uniqueTag();

		const MyElement = component(function* () {
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
		//a global registry holding the host strongly — cache, observer registration, listener — leaks
		//one instance per cycle here
		//the count stays small for speed; collecting only after the loop is what surfaces the leak
		const tag = uniqueTag();
		const MyElement = component(function* () {
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
