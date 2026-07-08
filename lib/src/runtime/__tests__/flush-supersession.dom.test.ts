import { describe, expect, test } from "vitest";
import { html, render } from "../../index";

/*
spec for the flush scheduler's supersession semantic. an update() that arrives while a previous render
is still in flight (suspended mid-render on a yielded promise) must SUPERSEDE it — the newer render
wins immediately and the stale one is abandoned — rather than DEFER (let the stale render finish, then
re-run). these pin the behavior end-to-end through the public update() surface; the pure transition is
in task.dom.test.

supersession is by slot identity: a rerun swaps the inner slot (so an in-flight inner is abandoned) and
never touches the outer slot (so a suspended outer survives to capture its cleanup). teardown nulls the
slots before running finallys, so a cleanup that re-enters update() is a no-op.
*/

let counter = 0;
const uniqueTag = () => `test-flush-${counter++}-${Date.now()}`;
const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

const mount = (constructor: CustomElementConstructor): HTMLElement => {
	const tag = uniqueTag();
	customElements.define(tag, constructor);
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element;
};

type Updatable = HTMLElement & { update(): Promise<void> };

describe("flush supersession", () => {
	test("an update during a suspended async render wins immediately and abandons the stale render's tail", async () => {
		let value = "init";
		let suspendThisRender = false;
		const gate = Promise.withResolvers<void>();
		const tailRan: string[] = [];

		const element = mount(
			render(function* () {
				yield function* current() {
					const snapshot = value;
					yield () => html`<p>${snapshot}</p>`;
					if (suspendThisRender) {
						yield gate.promise; //suspend mid-render
						tailRan.push(snapshot); //a superseded render must never reach here
						yield () => html`<p>tail-${snapshot}</p>`;
					}
				};
			}),
		) as Updatable;

		await sleep();
		expect(element.shadowRoot?.textContent).toContain("init");

		//first update renders "first", then parks mid-render on the gate
		value = "first";
		suspendThisRender = true;
		element.update();
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("first");
		expect(tailRan).toEqual([]); //still parked

		//a second update arrives while "first" is still suspended: it must take effect immediately,
		//not wait for the stale render to drain
		value = "second";
		suspendThisRender = false; //the superseding render completes synchronously
		element.update();
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("second");

		//releasing the original gate must NOT revive the superseded render
		gate.resolve();
		await sleep();
		expect(tailRan).toEqual([]); //the stale tail never executed
		expect(element.shadowRoot?.textContent).toContain("second");

		element.remove();
	});

	test("an update while the outer is still suspended must not strand the outer's cleanup", async () => {
		const outerGate = Promise.withResolvers<void>();
		let outerCleanupRan = false;
		let value = "A";

		const element = mount(
			render(function* () {
				yield function* () {
					//inner / current renderer
					yield () => html`<p>${value}</p>`;
				};
				yield outerGate.promise; //outer suspends AFTER installing the inner
				return () => {
					outerCleanupRan = true; //outer cleanup (D2) — must survive a mid-flight supersede
				};
			}),
		) as Updatable;

		await sleep();
		expect(element.shadowRoot?.textContent).toContain("A");

		//supersede the inner while the outer is still parked on its await
		value = "B";
		element.update();
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("B");

		//the outer's await settles after the epoch has already moved on
		outerGate.resolve();
		await sleep();

		//disconnect must run the outer's captured cleanup
		element.remove();
		await sleep();
		expect(outerCleanupRan).toBe(true);
	});

	test("await update() resolves when it supersedes an in-flight async render", async () => {
		let suspend = true;
		const gate = Promise.withResolvers<void>();

		const element = mount(
			render(function* () {
				yield function* current() {
					const willSuspend = suspend;
					yield () => html`<p>body</p>`;
					if (willSuspend) yield gate.promise; //park the initial render mid-flight
				};
			}),
		) as Updatable;

		await sleep();
		expect(element.shadowRoot?.textContent).toContain("body"); //inner painted, then parked

		//supersede the parked inner; the superseding render completes synchronously. the root has no
		//parent to settle it, so historically the DOM landed but this update() promise never resolved.
		suspend = false;
		const settled = element.update().then(() => "resolved");
		const outcome = await Promise.race([
			settled,
			sleep(1000).then(() => "hung"),
		]);
		expect(outcome).toBe("resolved");

		gate.resolve(); //releasing the abandoned render must not revive it
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("body");

		element.remove();
	});

	test("a cleanup that calls update() during disconnect does not repaint", async () => {
		let renders = 0;
		let cleanupRan = false;

		const element = mount(
			render(function* () {
				yield () => {
					renders++;
					return html`<p>live</p>`;
				};
				return () => {
					cleanupRan = true;
					element.update(); //re-enter update() from inside teardown
				};
			}),
		) as Updatable;

		await sleep();
		expect(renders).toBe(1);

		element.remove();
		await sleep();
		expect(cleanupRan).toBe(true);
		expect(renders).toBe(1); //the slots were nulled before the cleanup ran, so update() no-ops
	});
});
