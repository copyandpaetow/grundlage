// @vitest-environment happy-dom
import { describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";
import { bench } from "./bench-options";

/*
Mirrors the raf-animation-list demo's steady-state per-frame work: a 20-item list of bar rows where every numeric expression changes every frame.
each item is a fresh HTMLTemplate with 6 expressions (label, four floats, integer counter) and the outer template wraps the list with two more changing expressions.

every item changes every frame, so the list reconciliation always lands in the structural-claim path (no hash hits, no head/tail peel) and runs .update() on every inner template. the other list benches in list-reconciliation.bench.ts alternate between two pre-built shapes — they don't model the "new templates every frame, no hash hits, full per-item .update()" load that the demo hits at 60-144Hz.

the single-bar-row bench isolates the per-item .update() cost from the surrounding renderList allocation work:
  - if the list bench regresses but the single-bar bench doesn't, the cost is inside renderList (Tier 2.6 scratch allocation)
  - if both move together, the cost is in updateAttribute / updateContent dispatch (binding-shape switch, larger binding objects)
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

describe("HTMLTemplate.update() — raf-animation-list steady state", () => {
	const barCount = 20;
	const phases = Array.from(
		{ length: barCount },
		(_, index) => index * 0.3,
	);

	const formatLabel = (index: number) =>
		`b${index.toString().padStart(2, "0")}`;

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

	const buildFrame = (time: number, remainingFrames: number) => {
		const bars = phases.map((phase, index) => computeBar(time, phase, index));
		return html`
			<h1>frames left: ${remainingFrames} · t=${time}</h1>
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

	const mounted = renderOnce(buildFrame(0, 30_000));

	let frame = 0;
	bench("20-bar list, all floats change every frame", () => {
		frame++;
		const time = frame / 60;
		const next = buildFrame(time, 30_000 - frame);
		mounted.update(next.currentExpressions);
	});
});

describe("HTMLTemplate.update() — single bar row (float-heavy attrs)", () => {
	const rowTemplate = renderOnce(html`
		<div class="row">
			<span>${"b00"}</span>
			<div
				class="bar"
				style="width:${50}%;background:hsl(${0},70%,${50}%);opacity:${1}"
			></div>
			<span>${0}</span>
		</div>
	`);

	let frame = 0;
	bench("6 expressions (1 string, 4 floats, 1 int) all change", () => {
		frame++;
		const time = frame / 60;
		rowTemplate.update([
			`b${(frame % 100).toString().padStart(2, "0")}`,
			50 + 45 * Math.sin(time),
			(time * 53) % 360,
			45 + 15 * Math.cos(time * 1.3),
			0.4 + 0.6 * Math.abs(Math.sin(time * 0.7)),
			Math.floor(time * 1000) % 10000,
		]);
	});
});
