import { component, html, prop } from "../../../../lib/src";
import { benchLayoutFromLocation, chunkEdgeFromLocation, type BenchLayout } from "./bench-grid";
import {
	type Baseline,
	clearBaseline,
	formatDelta,
	loadBaseline,
	saveBaseline,
} from "../../../src/measure";
import {
	BENCH_VARIANTS,
	type BenchVariant,
	benchVariantFromLocation,
	type FrameStatistics,
	measureDisplayFrameMilliseconds,
	mountBenchScene,
	type ScenarioName,
	scenarios,
	unmountBenchScene,
} from "./frame-scenarios";

//The fixed count runs where frames already run long, so a saving shows 1:1 instead of
//hiding between two refresh steps. One round swings 10 to 25% on an M3, so rounds interleave
//and medians compare against spreads.

const BREAK_POINT_SCENARIOS = ["fly", "dragFifty"] as const;
type BreakPointScenario = (typeof BREAK_POINT_SCENARIOS)[number];
type BreakPoints = Record<BreakPointScenario, number>;
//Baselines saved before variants existed carry none and ran unculled grundlage; older
//variant names (face-culling, ...) stay as they were saved.
type BreakPointResult = {
	displayFrameMilliseconds: number;
	breakPoints: BreakPoints;
	variant?: BenchVariant;
	chunkEdge?: number | null;
	layout?: BenchLayout;
};
type Spread = { median: number; minimum: number; maximum: number };
type ScenarioSpread = {
	medianFrameMilliseconds: Spread;
	slowestTwentiethFrameMilliseconds: Spread;
};
type RunOnceResult = {
	displayFrameMilliseconds: number;
	cubeCount: number;
	variant: BenchVariant;
	chunkEdge?: number | null;
	layout?: BenchLayout;
	roundCount: number;
	spreadByScenario: Record<ScenarioName, ScenarioSpread>;
};

const spreadOf = (values: readonly number[]): Spread => {
	const sorted = values.toSorted((first, second) => first - second);
	return {
		median: sorted[Math.floor(sorted.length / 2)],
		minimum: sorted[0],
		maximum: sorted[sorted.length - 1],
	};
};

const formatSpread = (spread: Spread | undefined): string =>
	spread === undefined
		? "–"
		: `${spread.median.toFixed(1)} ms (${spread.minimum.toFixed(1)}–${spread.maximum.toFixed(1)})`;

//Overlapping ranges cannot tell the two runs apart, whatever the medians say
const compareSpreads = (now: Spread, before: Spread): string =>
	now.minimum <= before.maximum && before.minimum <= now.maximum
		? `${formatDelta(now.median, before.median)}, within noise`
		: formatDelta(now.median, before.median);

const SCENARIO_LABELS: Record<ScenarioName, string> = {
	fly: "camera fly",
	look: "camera look",
	dragOne: "drag 1 cube",
	dragFifty: "drag 50 cubes",
};

//The labels record holds exactly one key per scenario
const SCENARIO_NAMES = Object.keys(SCENARIO_LABELS) as ScenarioName[];

const STARTING_CUBE_COUNT = 250;
const CUBE_COUNT_LIMIT = 64000;
const REFINEMENT_STEP_LIMIT = 4;
const CUBE_COUNT_GRANULARITY = 50;
const MEASURED_FRAME_COUNT = 120;
const SETTLING_FRAME_COUNT = 30;
//Five late frames in a hundred still counts as smooth: one GC pause must not end a run.
const LATE_FRAME_FRACTION_LIMIT = 0.05;
const BREAK_POINT_BASELINE_STORAGE_KEY = "grundlage:cubes:baseline:v1";
//v2: spreads over rounds; v1 single-round baselines do not compare
const RUN_ONCE_BASELINE_STORAGE_KEY = "grundlage:cubes:run-once-baseline:v2";
const RUN_ONCE_ROUND_COUNT = 5;

const holdsDisplayRate = (statistics: FrameStatistics): boolean =>
	statistics.lateFrameCount <= statistics.frameCount * LATE_FRAME_FRACTION_LIMIT;

const describeStatistics = (statistics: FrameStatistics): string =>
	`p50 ${statistics.medianFrameMilliseconds.toFixed(1)} ms · p95 ${statistics.slowestTwentiethFrameMilliseconds.toFixed(1)} ms · ${statistics.lateFrameCount}/${statistics.frameCount} late · ${statistics.domMutationCount} DOM mutations`;

const refreshRateOf = (frameMilliseconds: number): number => Math.round(1000 / frameMilliseconds);

//rAF intervals jitter around the refresh, so 6.9 ms and 7.0 ms are both 144 Hz.
const REFRESH_RATE_TOLERANCE_FRACTION = 0.1;
const refreshRatesDifferBetween = (
	firstFrameMilliseconds: number,
	secondFrameMilliseconds: number,
): boolean =>
	Math.abs(firstFrameMilliseconds - secondFrameMilliseconds) >
	Math.min(firstFrameMilliseconds, secondFrameMilliseconds) * REFRESH_RATE_TOLERANCE_FRACTION;

const refreshRateWarningOf = (
	latestFrameMilliseconds: number,
	baselineFrameMilliseconds: number,
): string | null =>
	refreshRatesDifferBetween(latestFrameMilliseconds, baselineFrameMilliseconds)
		? `The baseline ran at ${refreshRateOf(baselineFrameMilliseconds)} Hz and this run at ${refreshRateOf(latestFrameMilliseconds)} Hz, so they do not compare.`
		: null;

const variantOf = (result: {
	variant?: BenchVariant;
	chunkEdge?: number | null;
	layout?: BenchLayout;
}): string =>
	(result.variant ?? "none") +
	(result.chunkEdge == null ? "" : `, chunks of ${result.chunkEdge}`) +
	(result.layout === undefined || result.layout === "floor" ? "" : `, ${result.layout}`);

const benchStyles = html`
	<style>
		:host {
			display: block;
			margin-top: 1rem;
			font: 13px monospace;
		}
		section {
			margin-top: 1.25rem;
		}
		h3 {
			margin: 0 0 6px;
			font-size: inherit;
		}
		.controls {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			align-items: center;
		}
		button,
		input,
		select {
			padding: 6px 12px;
			font: inherit;
		}
		button {
			cursor: pointer;
		}
		input {
			width: 7em;
		}
		table {
			margin-top: 10px;
			border-collapse: collapse;
		}
		th,
		td {
			text-align: left;
			padding: 4px 12px 4px 0;
			border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		}
		.muted {
			opacity: 0.65;
		}
		ol {
			padding-left: 1.5em;
		}
	</style>
`;

const breakPointTable = (
	latestBreakPoints: BreakPointResult | null,
	breakPointBaseline: Baseline<BreakPointResult> | null,
) => {
	const breakPointWarning =
		latestBreakPoints && breakPointBaseline
			? refreshRateWarningOf(
					latestBreakPoints.displayFrameMilliseconds,
					breakPointBaseline.value.displayFrameMilliseconds,
				)
			: null;
	return html`
		<table>
			<thead>
				<tr>
					<th>smooth up to</th>
					<th>
						now (${latestBreakPoints ? variantOf(latestBreakPoints) : "–"})
					</th>
					<th>
						baseline
						(${breakPointBaseline ? variantOf(breakPointBaseline.value) : "–"})
					</th>
					<th>vs baseline</th>
				</tr>
			</thead>
			<tbody>
				${BREAK_POINT_SCENARIOS.map((scenario) => {
					const now = latestBreakPoints?.breakPoints[scenario];
					const before = breakPointBaseline?.value.breakPoints[scenario];
					return html`<tr>
						<td>${SCENARIO_LABELS[scenario]}</td>
						<td>${now ?? "–"}</td>
						<td>${before ?? "–"}</td>
						<td>
							${now === undefined || before === undefined ? "–" : formatDelta(now, before)}
						</td>
					</tr>`;
				})}
			</tbody>
		</table>
		${breakPointWarning ? html`<p>${breakPointWarning}</p>` : null}
	`;
};

const runOnceWarningOf = (
	latestRunOnce: RunOnceResult,
	runOnceBaseline: Baseline<RunOnceResult>,
): string | null =>
	latestRunOnce.cubeCount !== runOnceBaseline.value.cubeCount
		? `The baseline ran at ${runOnceBaseline.value.cubeCount} cubes and this run at ${latestRunOnce.cubeCount}, so they do not compare.`
		: refreshRateWarningOf(
				latestRunOnce.displayFrameMilliseconds,
				runOnceBaseline.value.displayFrameMilliseconds,
			);

const runOnceTable = (
	latestRunOnce: RunOnceResult | null,
	runOnceBaseline: Baseline<RunOnceResult> | null,
) => {
	const runOnceWarning =
		latestRunOnce && runOnceBaseline ? runOnceWarningOf(latestRunOnce, runOnceBaseline) : null;
	return html`
		<table>
			<thead>
				<tr>
					<th>p50 frame, median (range)</th>
					<th>now (${latestRunOnce ? variantOf(latestRunOnce) : "–"})</th>
					<th>
						baseline
						(${runOnceBaseline ? variantOf(runOnceBaseline.value) : "–"})
					</th>
					<th>vs baseline</th>
					<th>p95 now, median (range)</th>
					<th>p95 baseline</th>
					<th>vs baseline</th>
				</tr>
			</thead>
			<tbody>
				${SCENARIO_NAMES.map((scenario) => {
					const now = latestRunOnce?.spreadByScenario[scenario];
					const before = runOnceBaseline?.value.spreadByScenario[scenario];
					return html`<tr>
						<td>${SCENARIO_LABELS[scenario]}</td>
						<td>${formatSpread(now?.medianFrameMilliseconds)}</td>
						<td>${formatSpread(before?.medianFrameMilliseconds)}</td>
						<td>
							${
								now && before
									? compareSpreads(now.medianFrameMilliseconds, before.medianFrameMilliseconds)
									: "–"
							}
						</td>
						<td>${formatSpread(now?.slowestTwentiethFrameMilliseconds)}</td>
						<td>${formatSpread(before?.slowestTwentiethFrameMilliseconds)}</td>
						<td>
							${
								now && before
									? compareSpreads(
											now.slowestTwentiethFrameMilliseconds,
											before.slowestTwentiethFrameMilliseconds,
										)
									: "–"
							}
						</td>
					</tr>`;
				})}
			</tbody>
		</table>
		${runOnceWarning ? html`<p>${runOnceWarning}</p>` : null}
	`;
};

//The cubes-vanilla page sets its scene's variant; a variant in the URL wins over either
const props = {
	variant: prop.attribute(prop.oneOf(...BENCH_VARIANTS), "grundlage"),
};

customElements.define(
	"scene-bench",
	component(
		//oxlint-disable-next-line max-lines-per-function -- long, not complex: one component's state, handlers and view
		function* ({ host, variant: variantAttribute }) {
			let isRunning = false;
			let status = "Idle. The page's scene is swapped for a generated grid while a run lasts.";
			let steps: string[] = [];
			let latestBreakPoints: BreakPointResult | null = null;
			let breakPointBaseline: Baseline<BreakPointResult> | null = loadBaseline<BreakPointResult>(
				BREAK_POINT_BASELINE_STORAGE_KEY,
			);
			let latestRunOnce: RunOnceResult | null = null;
			let runOnceBaseline: Baseline<RunOnceResult> | null = loadBaseline<RunOnceResult>(
				RUN_ONCE_BASELINE_STORAGE_KEY,
			);
			let onceCubeCount = 1000;
			let variant: BenchVariant = benchVariantFromLocation(variantAttribute);

			const report = (message: string) => {
				status = message;
				return host.update();
			};

			const logStep = (message: string) => {
				steps = [...steps, message];
				return host.update();
			};

			const runScenarioAt = async (
				scenario: ScenarioName,
				cubeCount: number,
				displayFrameMilliseconds: number,
			): Promise<FrameStatistics> => {
				await report(`${SCENARIO_LABELS[scenario]}: mounting ${cubeCount} cubes...`);
				await mountBenchScene(cubeCount, displayFrameMilliseconds, variant);
				await scenarios.idle(SETTLING_FRAME_COUNT);
				return scenarios[scenario](MEASURED_FRAME_COUNT);
			};

			const findBreakPoint = async (
				scenario: BreakPointScenario,
				displayFrameMilliseconds: number,
			): Promise<number> => {
				const isSmoothAt = async (cubeCount: number): Promise<boolean> => {
					const statistics = await runScenarioAt(scenario, cubeCount, displayFrameMilliseconds);
					const isSmooth = holdsDisplayRate(statistics);
					await logStep(
						`${SCENARIO_LABELS[scenario]} · ${cubeCount} cubes · ${describeStatistics(statistics)} · ${isSmooth ? "smooth" : "late"}`,
					);
					return isSmooth;
				};

				let largestSmoothCount = 0;
				let smallestLateCount: number | null = null;
				for (let cubeCount = STARTING_CUBE_COUNT; cubeCount <= CUBE_COUNT_LIMIT; cubeCount *= 2) {
					if (!(await isSmoothAt(cubeCount))) {
						smallestLateCount = cubeCount;
						break;
					}
					largestSmoothCount = cubeCount;
				}
				if (smallestLateCount === null) return largestSmoothCount;

				let lateCount: number = smallestLateCount;
				for (let step = 0; step < REFINEMENT_STEP_LIMIT; step++) {
					const middleCount =
						Math.round((largestSmoothCount + lateCount) / 2 / CUBE_COUNT_GRANULARITY) *
						CUBE_COUNT_GRANULARITY;
					if (middleCount <= largestSmoothCount || middleCount >= lateCount) break;
					if (await isSmoothAt(middleCount)) largestSmoothCount = middleCount;
					else lateCount = middleCount;
				}
				return largestSmoothCount;
			};

			const runExclusively = async (work: () => Promise<void>) => {
				isRunning = true;
				steps = [];
				await host.update();
				try {
					await work();
				} catch (reason) {
					await report(`Failed: ${reason instanceof Error ? reason.message : String(reason)}`);
				} finally {
					unmountBenchScene();
					isRunning = false;
					void host.update();
				}
			};

			const findBreakPoints = () =>
				runExclusively(async () => {
					await report("Measuring the display refresh...");
					const displayFrameMilliseconds = await measureDisplayFrameMilliseconds();
					const breakPoints: Partial<BreakPoints> = {};
					for (const scenario of BREAK_POINT_SCENARIOS) {
						breakPoints[scenario] = await findBreakPoint(scenario, displayFrameMilliseconds);
					}
					latestBreakPoints = {
						displayFrameMilliseconds,
						breakPoints: breakPoints as BreakPoints,
						variant,
						chunkEdge: chunkEdgeFromLocation(),
						layout: benchLayoutFromLocation(),
					};
					//eslint-disable-next-line no-console
					console.log("cubes bench", JSON.stringify(latestBreakPoints));
					await report("Done.");
				});

			const runOnce = () =>
				runExclusively(async () => {
					const displayFrameMilliseconds = await measureDisplayFrameMilliseconds();
					const roundsByScenario = new Map<ScenarioName, FrameStatistics[]>(
						SCENARIO_NAMES.map((scenario) => [scenario, []]),
					);
					for (let round = 1; round <= RUN_ONCE_ROUND_COUNT; round++) {
						for (const scenario of SCENARIO_NAMES) {
							const statistics = await runScenarioAt(
								scenario,
								onceCubeCount,
								displayFrameMilliseconds,
							);
							roundsByScenario.get(scenario)?.push(statistics);
							await logStep(
								`round ${round}/${RUN_ONCE_ROUND_COUNT} · ${SCENARIO_LABELS[scenario]} · ${onceCubeCount} cubes · ${describeStatistics(statistics)}`,
							);
						}
					}
					const spreadByScenario: Partial<Record<ScenarioName, ScenarioSpread>> = {};
					for (const [scenario, rounds] of roundsByScenario) {
						spreadByScenario[scenario] = {
							medianFrameMilliseconds: spreadOf(
								rounds.map((statistics) => statistics.medianFrameMilliseconds),
							),
							slowestTwentiethFrameMilliseconds: spreadOf(
								rounds.map((statistics) => statistics.slowestTwentiethFrameMilliseconds),
							),
						};
					}
					latestRunOnce = {
						displayFrameMilliseconds,
						cubeCount: onceCubeCount,
						variant,
						chunkEdge: chunkEdgeFromLocation(),
						layout: benchLayoutFromLocation(),
						roundCount: RUN_ONCE_ROUND_COUNT,
						//The map holds every scenario, so every key was assigned above
						spreadByScenario: spreadByScenario as Record<ScenarioName, ScenarioSpread>,
					};
					//eslint-disable-next-line no-console
					console.log("cubes bench run once", JSON.stringify(latestRunOnce));
					await report(`Done at ${onceCubeCount} cubes, variant ${variant}.`);
				});

			const readOnceCubeCount = (event: Event) => {
				const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
				if (Number.isInteger(value) && value > 0) onceCubeCount = value;
			};

			const readVariant = (event: Event) => {
				const value = (event.currentTarget as HTMLSelectElement).value;
				variant = BENCH_VARIANTS.find((candidate) => candidate === value) ?? "grundlage";
			};

			const promoteBreakPointsToBaseline = () => {
				if (latestBreakPoints === null) return;
				breakPointBaseline = saveBaseline(BREAK_POINT_BASELINE_STORAGE_KEY, latestBreakPoints);
				void host.update();
			};

			const dropBreakPointBaseline = () => {
				breakPointBaseline = null;
				clearBaseline(BREAK_POINT_BASELINE_STORAGE_KEY);
				void host.update();
			};

			const promoteRunOnceToBaseline = () => {
				if (latestRunOnce === null) return;
				runOnceBaseline = saveBaseline(RUN_ONCE_BASELINE_STORAGE_KEY, latestRunOnce);
				void host.update();
			};

			const dropRunOnceBaseline = () => {
				runOnceBaseline = null;
				clearBaseline(RUN_ONCE_BASELINE_STORAGE_KEY);
				void host.update();
			};

			//oxlint-disable-next-line max-lines-per-function -- long, not complex: one template
			yield function* view() {
				yield html`
					${benchStyles}
					<div class="controls">
						<label>
							variant
							<select onChange=${readVariant} disabled=${isRunning}>
								${BENCH_VARIANTS.map(
									(candidate) =>
										html`<option
											value=${candidate}
											selected=${candidate === variant}
										>
											${candidate}
										</option>`,
								)}
							</select>
						</label>
					</div>

					<section>
						<h3>Break points</h3>
						<div class="controls">
							<button onClick=${findBreakPoints} disabled=${isRunning}>
								find break points
							</button>
							<button
								onClick=${promoteBreakPointsToBaseline}
								disabled=${latestBreakPoints === null || isRunning}
							>
								save as baseline
							</button>
							<button
								onClick=${dropBreakPointBaseline}
								disabled=${breakPointBaseline === null || isRunning}
							>
								clear baseline
							</button>
							${
								breakPointBaseline
									? html`<span class="muted"
											>baseline captured ${breakPointBaseline.capturedAt} at
											${refreshRateOf(breakPointBaseline.value.displayFrameMilliseconds)}
											Hz</span
										>`
									: html`<span class="muted">no baseline saved</span>`
							}
						</div>
						${breakPointTable(latestBreakPoints, breakPointBaseline)}
					</section>

					<section>
						<h3>Fixed count</h3>
						<div class="controls">
							<label>
								at
								<input
									type="number"
									min="1"
									step="250"
									value=${onceCubeCount}
									onChange=${readOnceCubeCount}
									disabled=${isRunning}
								/>
								cubes
							</label>
							<button onClick=${runOnce} disabled=${isRunning}>
								run ${RUN_ONCE_ROUND_COUNT} rounds
							</button>
							<button
								onClick=${promoteRunOnceToBaseline}
								disabled=${latestRunOnce === null || isRunning}
							>
								save as baseline
							</button>
							<button
								onClick=${dropRunOnceBaseline}
								disabled=${runOnceBaseline === null || isRunning}
							>
								clear baseline
							</button>
							${
								runOnceBaseline
									? html`<span class="muted"
											>baseline captured ${runOnceBaseline.capturedAt},
											${runOnceBaseline.value.cubeCount} cubes,
											${variantOf(runOnceBaseline.value)}, at
											${refreshRateOf(runOnceBaseline.value.displayFrameMilliseconds)}
											Hz</span
										>`
									: html`<span class="muted">no baseline saved</span>`
							}
						</div>
						${runOnceTable(latestRunOnce, runOnceBaseline)}
					</section>

					<p role="status">${status}</p>
					<ol class="muted">
						${steps.map((step) => html`<li>${step}</li>`)}
					</ol>
				`;
			};
		},
		{ props },
	),
);
