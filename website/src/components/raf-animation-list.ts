import { html, render } from "../../../lib/src";
import {
	clearBaseline,
	formatDelta,
	loadBaseline,
	measureWindow,
	saveBaseline,
	type WindowResult,
} from "../measure";

const BASELINE_STORAGE_KEY = "grundlage:animation-list:baseline";

// fps reads better when higher; frame time and writes/frame read better when
// lower. Both use the same 2% band — window mode is wall-clock noisy, so frame
// count (and the writes/frame ratio over it) drifts run to run.
const classWhenHigherIsBetter = (current: number, previous: number): string =>
	current > previous * 1.02
		? "improve"
		: current < previous * 0.98
			? "regress"
			: "";

const classWhenLowerIsBetter = (current: number, previous: number): string =>
	current < previous * 0.98
		? "improve"
		: current > previous * 1.02
			? "regress"
			: "";

/*
    Window-mode probe. A self-driving animated list where every bar changes
    every frame, so each frame the list reconciliation walks all bars with
    fresh values — it exercises enemy #2 (per-frame allocation) and surfaces
    any false rebuilds.

    The animation owns its rAF loop; the shared measureWindow harness only
    OBSERVES it for a wall-clock window and reports fps, frame time, DOM writes
    per frame, and heap delta — the executable form of lib/CONVENTIONS.md's
    "Measuring" contract. Set `bars` to push bar count up and find where
    allocation / DOM-write volume starts dropping frames under CPU throttle.
*/

customElements.define(
	"raf-animation-list",
	render(function* (element) {
		const barCount = Number(element.getAttribute("bars") ?? 20);
		const phases = Array.from({ length: barCount }, (_, index) => index * 0.3);

		let time = 0;
		let isMeasuring = false;
		let result: WindowResult | null = null;
		let animating = false;
		let durationMs = Number(element.getAttribute("duration") ?? 3000);
		let baseline = loadBaseline<WindowResult>(BASELINE_STORAGE_KEY);

		// The animation only runs while a measurement is in flight — clicking
		// measure starts it, the window ends it. Idle, the list sits on its last
		// frame (no rAF, no DOM churn).
		const tick = () => {
			if (!animating) return;
			time += 1 / 60;
			element.update();
			requestAnimationFrame(tick);
		};

		// Observe only the animating list, not the controls/result chrome.
		const barsRoot = (): Node =>
			element.shadowRoot?.querySelector(".bars") ??
			element.shadowRoot ??
			element;

		const measure = async () => {
			if (isMeasuring) return;
			isMeasuring = true;
			result = null;
			animating = true;
			element.update();
			requestAnimationFrame(tick);
			result = await measureWindow(barsRoot(), durationMs);
			animating = false;
			isMeasuring = false;
			element.update();
		};

		const promoteToBaseline = () => {
			if (!result) return;
			baseline = saveBaseline(BASELINE_STORAGE_KEY, result);
			element.update();
		};

		const dropBaseline = () => {
			baseline = null;
			clearBaseline(BASELINE_STORAGE_KEY);
			element.update();
		};

		const computeBar = (phase: number, barIndex: number) => {
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

		const formatLabel = (index: number) =>
			`b${index.toString().padStart(2, "0")}`;

		const formatNumber = (value: number, digits = 2) => value.toFixed(digits);

		// One result row: the current value, plus a colored delta against the
		// baseline when one is saved.
		const metricRow = (
			label: string,
			formatted: string,
			delta: string,
			deltaClass: string,
		) => html`
			<span>${label}</span>
			<span
				>${formatted}${delta
					? html` <span class="delta ${deltaClass}">${delta}</span>`
					: ""}</span
			>
		`;

		try {
			yield () => {
				const bars = phases.map((phase, index) => computeBar(phase, index));

				return html`
					<style>
						:host {
							display: block;
							font: 12px monospace;
						}

						button {
							padding: 6px 12px;
							font: inherit;
							cursor: pointer;
						}

						button[disabled] {
							opacity: 0.6;
							cursor: progress;
						}

						.controls {
							display: flex;
							gap: 8px;
							align-items: center;
						}

						.grid {
							display: grid;
							grid-template-columns: max-content 1fr;
							gap: 4px 16px;
							margin: 12px 0;
						}

						.delta {
							margin-left: 8px;
						}

						.regress {
							color: #b00020;
						}

						.improve {
							color: #006a2b;
						}

						.bar {
							height: 8px;
							margin: 1px 0;
						}

						.row {
							display: grid;
							grid-template-columns: 40px 1fr 64px;
							gap: 4px;
							align-items: center;
						}
					</style>

					<div class="controls">
						<button onclick="${measure}" disabled="${isMeasuring}">
							${isMeasuring ? "measuring…" : "measure"}
						</button>
						<label>
							duration:
							<input
								type="number"
								min="100"
								step="100"
								value="${durationMs}"
								disabled="${isMeasuring}"
								oninput="${(event: Event) => {
									const next = Number((event.target as HTMLInputElement).value);
									if (Number.isFinite(next) && next > 0) durationMs = next;
								}}"
							/>
							ms
						</label>
						<span>${barCount} bars</span>
						<button
							onclick="${promoteToBaseline}"
							disabled="${!result || isMeasuring}"
						>
							save as baseline
						</button>
						<button
							onclick="${dropBaseline}"
							disabled="${!baseline || isMeasuring}"
						>
							clear baseline
						</button>
						${baseline
							? html`<span>baseline ${baseline.capturedAt}</span>`
							: html`<span>no baseline</span>`}
					</div>

					${result
						? (() => {
								const base = baseline?.value;
								return html`
									<div class="grid">
										${metricRow(
											"fps",
											formatNumber(result.framesPerSecond),
											base
												? formatDelta(
														result.framesPerSecond,
														base.framesPerSecond,
													)
												: "",
											base
												? classWhenHigherIsBetter(
														result.framesPerSecond,
														base.framesPerSecond,
													)
												: "",
										)}
										${metricRow(
											"median frame",
											`${formatNumber(result.medianFrameMs, 3)} ms`,
											base
												? formatDelta(result.medianFrameMs, base.medianFrameMs)
												: "",
											base
												? classWhenLowerIsBetter(
														result.medianFrameMs,
														base.medianFrameMs,
													)
												: "",
										)}
										${metricRow("frames", String(result.frames), "", "")}
										${metricRow(
											"DOM writes / frame",
											formatNumber(result.mutationsPerFrame),
											base
												? formatDelta(
														result.mutationsPerFrame,
														base.mutationsPerFrame,
													)
												: "",
											base
												? classWhenLowerIsBetter(
														result.mutationsPerFrame,
														base.mutationsPerFrame,
													)
												: "",
										)}
										${metricRow(
											"DOM writes total",
											String(result.mutations),
											"",
											"",
										)}
										${metricRow(
											"heap delta",
											result.heapDeltaMb !== null
												? `${formatNumber(result.heapDeltaMb)} MB`
												: "n/a",
											"",
											"",
										)}
									</div>
								`;
							})()
						: html``}

					<div class="bars">
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
					</div>
				`;
			};
		} finally {
			animating = false;
		}
	}),
);
