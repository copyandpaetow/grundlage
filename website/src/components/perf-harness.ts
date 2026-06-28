import { html, render } from "../../../lib/src";
import {
	clearBaseline,
	formatDelta,
	loadBaseline,
	measureWindow,
	saveBaseline,
	type WindowResult,
} from "../measure";

const BASELINE_STORAGE_KEY = "grundlage:perf-harness:baseline";

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
    Window-mode probe — the direct-binding baseline. Twenty bars are bound
    individually in the template (no array, no list diff), so measured against
    raf-animation-list it isolates the cost of list reconciliation from the cost
    of plain per-hole updates.

    Self-driving rAF loop; the shared measureWindow harness only OBSERVES it for
    a wall-clock window and reports fps, frame time, DOM writes per frame, and
    heap delta — the executable form of lib/CONVENTIONS.md's "Measuring"
    contract. Heap numbers need Chrome --enable-precise-memory-info to be
    byte-accurate; otherwise they round coarsely.
*/

customElements.define(
	"perf-harness",
	render(function* (element) {
		const busyValues = Array.from({ length: 20 }, (_, index) => index * 0.123);

		let frame = 0;
		let isMeasuring = false;
		let result: WindowResult | null = null;
		let animating = false;
		let durationMs = Number(element.getAttribute("duration") ?? 3000);
		let baseline = loadBaseline<WindowResult>(BASELINE_STORAGE_KEY);

		// Animates only while a measurement is in flight: measure starts it, the
		// window ends it. Idle, the bars sit still (no rAF, no DOM churn).
		const tick = () => {
			if (!animating) return;
			frame++;
			for (let index = 0; index < busyValues.length; index++) {
				const phase = frame / 60 + index * 0.3;
				busyValues[index] = 50 + 45 * Math.sin(phase);
			}
			element.update();
			requestAnimationFrame(tick);
		};

		// Observe only the animating bars, not the controls/result chrome.
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
			yield () => html`
				<style>
					:host {
						display: block;
						font: 13px monospace;
					}

					button {
						padding: 8px 16px;
						font: inherit;
						cursor: pointer;
					}

					button[disabled] {
						cursor: progress;
						opacity: 0.6;
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

					.bars {
						display: grid;
						gap: 2px;
					}

					.bar {
						height: 6px;
						background: steelblue;
					}
				</style>

				<div class="controls">
					<button onClick="${measure}" disabled="${isMeasuring}">
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
					<div class="bar" style="width:${busyValues[0]}%"></div>
					<div class="bar" style="width:${busyValues[1]}%"></div>
					<div class="bar" style="width:${busyValues[2]}%"></div>
					<div class="bar" style="width:${busyValues[3]}%"></div>
					<div class="bar" style="width:${busyValues[4]}%"></div>
					<div class="bar" style="width:${busyValues[5]}%"></div>
					<div class="bar" style="width:${busyValues[6]}%"></div>
					<div class="bar" style="width:${busyValues[7]}%"></div>
					<div class="bar" style="width:${busyValues[8]}%"></div>
					<div class="bar" style="width:${busyValues[9]}%"></div>
					<div class="bar" style="width:${busyValues[10]}%"></div>
					<div class="bar" style="width:${busyValues[11]}%"></div>
					<div class="bar" style="width:${busyValues[12]}%"></div>
					<div class="bar" style="width:${busyValues[13]}%"></div>
					<div class="bar" style="width:${busyValues[14]}%"></div>
					<div class="bar" style="width:${busyValues[15]}%"></div>
					<div class="bar" style="width:${busyValues[16]}%"></div>
					<div class="bar" style="width:${busyValues[17]}%"></div>
					<div class="bar" style="width:${busyValues[18]}%"></div>
					<div class="bar" style="width:${busyValues[19]}%"></div>
				</div>
			`;
		} finally {
			animating = false;
		}
	}),
);
