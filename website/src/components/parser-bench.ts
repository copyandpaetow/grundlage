import { component, html } from "../../../lib/src";
import {
	type Baseline,
	clearBaseline,
	formatDelta,
	loadBaseline,
	saveBaseline,
	waitForPaint,
} from "../measure";
import {
	corpusFromRecordedTemplates,
	CORPUS_SHAPES,
	generateCorpus,
	RECORDED_CORPUS_SHAPE,
	type RecordedTemplate,
} from "../parser-corpus";
import {
	fitHoleCost,
	type HoleCostFit,
	runShape,
	type ShapeResult,
} from "../parser-measure";
import recordedTemplates from "../../pages/parser-bench/recorded-corpus.json";

/*
    Runs every corpus shape through the parser and reports normalized work.

    Normalization is what makes the rows comparable: ns/char across shapes of
    different size, ns/hole within a group that holds characters fixed,
    µs/template for the fixed-cost series. Absolute pass times are an artifact
    of how many repeats a shape needed to clear the clock's 100µs granularity.

    A refactor wins when gzip bytes drop, the recorded control does not regress,
    and ns/char stays inside the instrument's ~8% floor. That floor is why the
    delta column only flags movement past it.
*/

const BASELINE_STORAGE_KEY = "grundlage:parser-bench:baseline";

/** The A/A floor of this instrument. Smaller movements are noise, not results. */
const RESOLUTION_PERCENT = 8;

customElements.define(
	"parser-bench",
	component(function* ({ host: element }) {
		const passes = Number(element.getAttribute("passes") ?? 40);
		let isRunning = false;
		let activeShape: string | null = null;
		let results: Array<ShapeResult> = [];
		let fits: Array<HoleCostFit> = [];
		let baseline: Baseline<Array<ShapeResult>> | null =
			loadBaseline<Array<ShapeResult>>(BASELINE_STORAGE_KEY);

		const buildCorpora = () => [
			...CORPUS_SHAPES.map(generateCorpus),
			corpusFromRecordedTemplates(
				RECORDED_CORPUS_SHAPE,
				recordedTemplates as Array<RecordedTemplate>,
			),
		];

		const runAllShapes = async () => {
			if (isRunning) return;
			isRunning = true;
			results = [];
			fits = [];
			element.update();
			await waitForPaint();

			const corpora = buildCorpora();
			for (let index = 0; index < corpora.length; index++) {
				activeShape = corpora[index].shape.name;
				element.update();
				await waitForPaint();
				const result = await runShape(corpora[index], {
					passes,
					measureRetainedHeap: true,
				});
				results.push(result);
				console.log(
					`shape ${index + 1}/${corpora.length} ${result.name} ${result.nanosecondsPerCharacter.toFixed(2)} ns/char${
						result.voidReasons.length === 0
							? ""
							: ` — VOID: ${result.voidReasons.join(", ")}`
					}`,
				);
			}

			fits = [
				fitHoleCost(
					"adjacent holes",
					results.filter(
						(result) =>
							result.group === "hole density" &&
							result.holeKind === "adjacentContent",
					),
				),
				fitHoleCost(
					"one element per hole",
					results.filter(
						(result) =>
							result.group === "hole density" && result.holeKind === "content",
					),
				),
			].filter((fit): fit is HoleCostFit => fit !== null);

			activeShape = null;
			isRunning = false;
			element.update();
			console.log(JSON.stringify({ passes, results, fits }, null, 2));
		};

		const promoteToBaseline = () => {
			if (results.length === 0) return;
			baseline = saveBaseline(BASELINE_STORAGE_KEY, results);
			element.update();
		};

		const dropBaseline = () => {
			baseline = null;
			clearBaseline(BASELINE_STORAGE_KEY);
			element.update();
		};

		const baselineFor = (name: string): ShapeResult | undefined =>
			baseline?.value.find((entry) => entry.name === name);

		const groupsInOrder = (): Array<string> => {
			const seen: Array<string> = [];
			for (let index = 0; index < results.length; index++) {
				if (!seen.includes(results[index].group)) seen.push(results[index].group);
			}
			return seen;
		};

		const voidCount = (): number =>
			results.filter((result) => result.voidReasons.length > 0).length;

		const isBeyondResolution = (current: number, previous: number): boolean =>
			previous !== 0 &&
			Math.abs(((current - previous) / previous) * 100) > RESOLUTION_PERCENT;

		yield () => html`
			<style>
				:host {
					display: block;
					font: 13px monospace;
				}

				button {
					padding: 6px 12px;
					font: inherit;
					cursor: pointer;
				}

				.controls {
					display: flex;
					flex-wrap: wrap;
					gap: 8px;
					align-items: center;
					margin-bottom: 12px;
				}

				.status {
					margin: 8px 0;
					opacity: 0.75;
				}

				.fits {
					display: flex;
					flex-wrap: wrap;
					gap: 24px;
					margin: 12px 0;
					padding: 10px 12px;
					border: 1px solid currentColor;
				}

				.fit-value {
					font-size: 18px;
				}

				.fit-label {
					opacity: 0.7;
				}

				table {
					border-collapse: collapse;
					width: 100%;
				}

				th,
				td {
					padding: 3px 10px 3px 0;
					text-align: right;
					white-space: nowrap;
				}

				th:first-child,
				td:first-child {
					text-align: left;
				}

				thead th {
					border-bottom: 1px solid currentColor;
				}

				tr.group-header td {
					padding-top: 14px;
					text-align: left;
					opacity: 0.7;
				}

				.beyond-resolution {
					font-weight: 700;
				}

				.within-resolution {
					opacity: 0.45;
				}

				.void-warning {
					font-weight: 700;
				}
			</style>

			<div class="controls">
				<button onclick="${runAllShapes}" disabled="${isRunning}">
					run ${CORPUS_SHAPES.length + 1} shapes
				</button>
				<button
					onclick="${promoteToBaseline}"
					disabled="${isRunning || results.length === 0}"
				>
					save as baseline
				</button>
				<button onclick="${dropBaseline}" disabled="${isRunning || !baseline}">
					clear baseline
				</button>
				<span
					>${passes} passes, best-of · ±${RESOLUTION_PERCENT}% resolution ·
					${voidCount()} void</span
				>
			</div>

			<div class="status">
				${
					isRunning
						? html`running: ${activeShape ?? "…"}`
						: baseline
							? html`baseline captured ${baseline.capturedAt}`
							: html`no baseline saved`
				}
			</div>

			${
				fits.length > 0
					? html`
							<div class="fits">
								${fits.map(
									(fit) => html`
										<div>
											<div class="fit-value">
												${fit.nanosecondsPerHole.toFixed(0)} ns/hole
											</div>
											<div class="fit-label">
												${fit.series} ·
												${fit.scannerNanosecondsPerCharacter.toFixed(2)} ns/char
												scanner · ${fit.pointCount} points
											</div>
										</div>
									`,
								)}
							</div>
						`
					: html``
			}

			${
				results.length === 0
					? html``
					: html`
							<table>
								<thead>
									<tr>
										<th>shape</th>
										<th>tmpl</th>
										<th>chars</th>
										<th>holes</th>
										<th>ns/char</th>
										<th>ns/hole</th>
										<th>µs/tmpl</th>
										<th>B/tmpl</th>
										<th>vs baseline</th>
									</tr>
								</thead>
								<tbody>
									${groupsInOrder().map(
										(group) => html`
											<tr class="group-header">
												<td colspan="9">${group}</td>
											</tr>
											${results
												.filter((result) => result.group === group)
												.map((result) => {
													const previous = baselineFor(result.name);
													return html`
														<tr>
															<td>
																${result.name}${
																	result.voidReasons.length === 0
																		? html``
																		: html`<span class="void-warning">
																				· VOID:
																				${result.voidReasons.join(", ")}</span
																			>`
																}
															</td>
															<td>${result.templateCount}</td>
															<td>${result.charactersPerTemplate}</td>
															<td>
																${(result.totalHoles / result.templateCount).toFixed(0)}
															</td>
															<td>
																${result.nanosecondsPerCharacter.toFixed(2)}
															</td>
															<td>
																${
																	result.nanosecondsPerHole === null
																		? "—"
																		: result.nanosecondsPerHole.toFixed(0)
																}
															</td>
															<td>
																${result.microsecondsPerTemplate.toFixed(2)}
															</td>
															<td>
																${
																	result.retainedBytesPerTemplate === null
																		? "—"
																		: result.retainedBytesPerTemplate.toFixed(0)
																}
															</td>
															<td
																class="${
																	previous
																		? isBeyondResolution(
																				result.nanosecondsPerCharacter,
																				previous.nanosecondsPerCharacter,
																			)
																			? "beyond-resolution"
																			: "within-resolution"
																		: ""
																}"
															>
																${
																	previous
																		? formatDelta(
																				result.nanosecondsPerCharacter,
																				previous.nanosecondsPerCharacter,
																			)
																		: "—"
																}
															</td>
														</tr>
													`;
												})}
										`,
									)}
								</tbody>
							</table>
						`
			}
		`;
	}),
);
