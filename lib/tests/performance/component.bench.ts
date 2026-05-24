// @vitest-environment happy-dom
import { afterAll, beforeAll, describe } from "vitest";
import { html, render } from "../../src/index";
import { bench } from "./bench-options";

/*
measures the full BaseElement update cycle — microtask scheduling, active.render(this), #renderToDom, observer state checks
the template-html.bench.ts file covers HTMLTemplate.update() in isolation; the gap between matching benches in these two files tells us what the component plumbing actually costs per frame
each iteration awaits update() so the microtask runs and the render completes before the next iteration

the benches below try to exercise every public component shape the library supports:
  - render-function source (yields () => html`...`)
  - static-template source (yields html`...`, never re-runs)
  - generator source from the outer generator
  - nested generator (outer yields a generator function)
  - root template that mirrors a host attribute back to the element
  - programmatic property writes via setProperty()
  - attribute writes via setAttribute() that the MutationObserver picks up
together they form a baseline we can grow with the library — new features show up as new benches, regressions show up as movement on the existing ones

we intentionally defer element creation into beforeAll() so each describe runs against a clean document.body
=> the previous shape (creating elements during describe-body evaluation) left every prior describe's element mounted while later describes' benches ran, so each later bench paid for the MutationObservers, microtask queues, and re-renders of every earlier component
*/

let tagCounter = 0;
const uniqueTag = () => `bench-component-${tagCounter++}`;

const defineConstructor = (
	componentGenerator: Parameters<typeof render>[0],
): string => {
	const tag = uniqueTag();
	customElements.define(tag, render(componentGenerator));
	return tag;
};

//helper: register the custom element synchronously (the registry is process-global so describe-body time is fine), but mount/unmount the instance inside beforeAll/afterAll so the element only lives in document.body during this describe's own benches
const useMountedElement = (
	componentGenerator: Parameters<typeof render>[0],
): (() => HTMLElement) => {
	const tag = defineConstructor(componentGenerator);
	let element: HTMLElement;
	beforeAll(() => {
		element = document.createElement(tag);
		document.body.appendChild(element);
	});
	afterAll(() => {
		element.remove();
	});
	return () => element;
};

const barCount = 20;
const phases = Array.from({ length: barCount }, (_, index) => index * 0.3);

const formatLabel = (index: number) => `b${index.toString().padStart(2, "0")}`;

const computeBar = (time: number, phase: number, barIndex: number) => {
	const currentPhase = time + phase;
	return {
		index: barIndex,
		width: 50 + 45 * Math.sin(currentPhase),
		hue: (currentPhase * 53) % 360,
		lightness: 45 + 15 * Math.cos(currentPhase * 1.3),
		opacity: 0.4 + 0.6 * Math.abs(Math.sin(currentPhase * 0.7)),
		counter: Math.floor(currentPhase * 1000) % 10000,
	};
};

const renderBars = (frame: number) => {
	const time = frame / 60;
	const bars = phases.map((phase, index) => computeBar(time, phase, index));
	return html`
		<style>
			.bar {
				height: 8px;
			}
			.row {
				display: grid;
				grid-template-columns: 40px 1fr 64px;
			}
		</style>
		<h1>frames left: ${30000 - frame} · t=${time}</h1>
		${bars.map(
			(bar) => html`
				<div class="row">
					<span>${formatLabel(bar.index)}</span>
					<div
						class="bar"
						style="width:${bar.width}%;background:hsl(${bar.hue},70%,${bar.lightness}%);opacity:${bar.opacity}"
					></div>
					<span>${bar.counter}</span>
				</div>
			`,
		)}
	`;
};

/*
mount cost — connectedCallback runs the outer generator once, advances to the first yield, and the synchronous flow lands all the way through #renderToDom for the initial paint
=> this measures the full one-time setup users pay every time a component appears in the DOM
each iteration creates a brand-new element so we never measure the "already-connected" early-bail in connectedCallback
*/
describe("BaseElement — mount (connect + initial render)", () => {
	const minimalTag = defineConstructor(function* () {
		yield () => html`<p>${"hello"}</p>`;
	});

	bench("minimal component (single text expression)", () => {
		const element = document.createElement(minimalTag);
		document.body.appendChild(element);
		element.remove();
	});

	let mountFrame = 0;
	const listTag = defineConstructor(function* () {
		yield () => renderBars(mountFrame++);
	});

	bench("20-bar list component", () => {
		const element = document.createElement(listTag);
		document.body.appendChild(element);
		element.remove();
	});
});

/*
control: render function yields the *same* HTMLTemplate every call
no per-frame template construction, no list reconciliation, no expression changes — just microtask + render-function call + #renderToDom's early-out path
=> the floor for "what does one update() cost when there's nothing to do?"
*/
describe("BaseElement.update() — identical template every frame (no-op floor)", () => {
	const stableTemplate = html`<p>stable</p>`;
	const getElement = useMountedElement(function* () {
		yield () => stableTemplate;
	});

	bench("microtask + #renderToDom early-out", async () => {
		await getElement().update();
	});
});

/*
render-function source — the most common shape in the wild (raf-animation-list, anything with element.update() driven re-renders)
the single-bar variant sets the floor for the "minimal moving parts" case; the 20-bar variant mirrors the raf-animation-list page that triggered this whole investigation
the gap to template-html.bench.ts's matching benches isolates the BaseElement plumbing cost on top of HTMLTemplate.update()
*/
describe("BaseElement.update() — render-function source", () => {
	let singleFrame = 0;
	const getSingleElement = useMountedElement(function* () {
		yield () => {
			singleFrame++;
			return html`
				<div
					style="width:${singleFrame % 100}%;background:hsl(${(singleFrame *
						7) %
					360},70%,50%);opacity:${(singleFrame % 100) / 100}"
				></div>
			`;
		};
	});

	bench("single bar, 3 floats change every frame", async () => {
		await getSingleElement().update();
	});

	let listFrame = 0;
	const getListElement = useMountedElement(function* () {
		yield () => renderBars(listFrame++);
	});

	bench("20-bar list, all floats change every frame", async () => {
		await getListElement().update();
	});
});

/*
generator source — the outer generator yields an HTMLTemplate and returns
every update() restarts a fresh generator from the top, runs the setup compute, yields the new template, exits
=> this benchmark catches regressions in #restartGenerator + advanceGenerator that a render-function bench would miss; the per-frame compute (incrementing outerFrame, building the expression) intentionally lives above the yield so each restart re-runs it
*/
describe("BaseElement.update() — generator source", () => {
	let outerFrame = 0;
	const getElement = useMountedElement(function* () {
		outerFrame++;
		yield html`
			<div
				style="width:${outerFrame % 100}%;background:hsl(${(outerFrame * 7) %
				360},70%,50%)"
			></div>
		`;
	});

	bench("single bar via generator (restartGenerator path)", async () => {
		await getElement().update();
	});
});

/*
nested generator — outer yields an inner generator function once; the inner becomes the active source and gets restarted on every update
the inner runs to completion on each restart (single yield, then return) — same lifecycle rule as the outer generator
=> covers the generator mixin feature added in #7; a regression in #installGeneratorSource or the inner-vs-outer source tracking shows up here
*/
describe("BaseElement.update() — nested generator", () => {
	let frame = 0;
	const getElement = useMountedElement(function* () {
		yield function* () {
			frame++;
			yield () => html`<p data-frame="${frame}">${`frame ${frame}`}</p>`;
		};
	});

	bench(
		"outer yields inner generator, inner restarts each update",
		async () => {
			await getElement().update();
		},
	);
});

/*
root template with host attribute — the feature added in #8; the template mirrors data-frame onto the component element itself
this forces #renderToDom's touchesHost branch (observer.disconnect → render → observer.observe) on every frame
=> the gap to the 20-bar render-function bench above isolates the cost of the observer-bracket pair plus host-attribute application
*/
describe("BaseElement.update() — root template with host attribute", () => {
	let frame = 0;
	const getElement = useMountedElement(function* () {
		yield () => {
			frame++;
			const time = frame / 60;
			const bars = phases.map((phase, index) => ({
				index,
				width: 50 + 45 * Math.sin(time + phase),
				hue: (time * 53 + index * 17) % 360,
			}));
			return html`
				<template data-frame="${frame}" class="bench-host">
					${bars.map(
						(bar) => html`
							<div
								style="width:${bar.width}%;background:hsl(${bar.hue},70%,50%)"
							></div>
						`,
					)}
				</template>
			`;
		};
	});

	bench(
		"20 bars + host attribute (observer disconnect/observe pair)",
		async () => {
			await getElement().update();
		},
	);
});

/*
setProperty path — applyAttributeBinding writes to the element then schedules an update()
this is the entry point any framework consumer hits when programmatically setting a non-stringable value (objects, functions, complex props)
=> a regression here means programmatic prop changes got slower, which affects every interactive component
*/
describe("BaseElement.setProperty() — programmatic property write", () => {
	let counter = 0;
	const getElement = useMountedElement(function* (host) {
		yield () => {
			const value = (host as HTMLElement).getAttribute("data-value") ?? "0";
			return html`<p>${value}</p>`;
		};
	});

	bench("setProperty(stringable) + awaited update", async () => {
		counter++;
		getElement().setProperty("data-value", String(counter));
		await getElement().update();
	});
});

/*
setAttribute path — writing an attribute fires the MutationObserver, which calls update()
covers the "external code or HTML changes my attribute" entry point; the cost includes the observer's microtask delivery plus the update() cycle
=> if observer-bracketing logic from #8 changed cost here (e.g. by recording extra mutations), this bench surfaces it
*/
describe("BaseElement — attribute change via setAttribute (MutationObserver path)", () => {
	let counter = 0;
	const getElement = useMountedElement(function* (host) {
		yield () => {
			const value = (host as HTMLElement).getAttribute("data-value") ?? "0";
			return html`<p>${value}</p>`;
		};
	});

	bench("setAttribute → observer → update", async () => {
		counter++;
		const element = getElement();
		element.setAttribute("data-value", String(counter));
		//two microtasks: one for the observer's record delivery, one for update()'s own batching await
		await Promise.resolve();
		await element.update();
	});
});

/*
list reconciliation through the full component path — same shape as the 20-bar list benches in template-html.bench.ts, but driven through element.update() rather than HTMLTemplate.update() directly
=> if list reconciliation looks fine in the template bench but slow here, the cost is somewhere between component.update() and HTMLTemplate.update() (microtask, render call, #renderToDom branching)
*/
describe("BaseElement.update() — list reconciliation through component", () => {
	const items = Array.from({ length: 20 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));

	const getElement = useMountedElement(function* () {
		yield () =>
			html`<ul>
				${items.map(
					(item) => html`<li data-id="${item.id}">${item.label}</li>`,
				)}
			</ul>`;
	});

	bench("20-item list, unchanged order (hash-hit reuse path)", async () => {
		await getElement().update();
	});

	bench("20-item list, one item mutated", async () => {
		items[10].label = `item-10-${items[10].id + Math.random()}`;
		await getElement().update();
	});
});
