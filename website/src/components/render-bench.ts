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
	deriveLaneGaps,
	type LaneGap,
	measureRegistryLookup,
	type RegistryLookupReading,
	runCommitShape,
	warmUpCommitShapes,
	type ShapeResult,
} from "../render-measure";
import {
	COMMIT_SHAPES,
	defineProbeElements,
	PLAIN_CUSTOM_ELEMENT_NAME,
} from "../render-shapes";

/*
    Runs every binding lane through patchInstance and reports ns per commit.

    The rows are not the point; the gaps between them are. P13 asks what a
    hole-free nameParts walk costs, and that is staticNameAttribute minus
    content on the unchanged rows: the gate hash is the only thing separating
    them. B4 asks what customElements.get costs, and no pair of lanes can answer
    that — Blink runs its own slower attribute path once the anchor has a dash
    in its name, and no cache here removes that — so the call is timed alone.

    A gap smaller than the noise of the rows it came from is not a small
    finding, it is no finding.

    A commit-path change wins when the lane it targets moves past the
    instrument's floor and no other lane does.
*/

const BASELINE_STORAGE_KEY = "grundlage:render-bench:baseline";

/** The A/A floor of this instrument. Smaller movements are noise, not results. */
const RESOLUTION_PERCENT = 6;

/** Enough calls that the 100µs clock granularity is two orders of magnitude down. */
const REGISTRY_LOOKUPS = 2_000_000;

customElements.define(
	"render-bench",
	component(function* ({ host: element }) {
		const passes = Number(element.getAttribute("passes") ?? 24);
		let isRunning = false;
		let activeShape: string | null = null;
		let results: Array<ShapeResult> = [];
		let gaps: Array<LaneGap> = [];
		let registryLookup: RegistryLookupReading | null = null;
		let baseline: Baseline<Array<ShapeResult>> | null =
			loadBaseline<Array<ShapeResult>>(BASELINE_STORAGE_KEY);

		defineProbeElements();

		const mountTarget = (): Element =>
			element.shadowRoot?.querySelector(".target") ?? element;

		const runAllShapes = async () => {
			if (isRunning) return;
			isRunning = true;
			results = [];
			gaps = [];
			registryLookup = null;
			activeShape = "warm-up";
			element.update();
			await waitForPaint();
			warmUpCommitShapes(COMMIT_SHAPES, mountTarget());

			for (let index = 0; index < COMMIT_SHAPES.length; index++) {
				activeShape = COMMIT_SHAPES[index].name;
				element.update();
				await waitForPaint();
				const result = await runCommitShape(
					COMMIT_SHAPES[index],
					mountTarget(),
					{ passes, measureHeapGrowth: true },
				);
				results.push(result);
				console.log(
					`shape ${index + 1}/${COMMIT_SHAPES.length} ${result.name} ${result.nanosecondsPerCommit.toFixed(1)} ns/commit${
						result.voidReasons.length === 0
							? ""
							: ` — VOID: ${result.voidReasons.join(", ")}`
					}`,
				);
			}

			gaps = deriveLaneGaps(results, RESOLUTION_PERCENT);
			registryLookup = measureRegistryLookup(
				PLAIN_CUSTOM_ELEMENT_NAME,
				REGISTRY_LOOKUPS,
			);
			activeShape = null;
			isRunning = false;
			element.update();
			console.log(
				JSON.stringify({ passes, results, gaps, registryLookup }, null, 2),
			);
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

		const churnsInOrder = (): Array<string> => {
			const seen: Array<string> = [];
			for (let index = 0; index < results.length; index++)
				if (!seen.includes(results[index].churn))
					seen.push(results[index].churn);
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

				.gaps {
					display: flex;
					flex-wrap: wrap;
					gap: 24px;
					margin: 12px 0;
					padding: 10px 12px;
					border: 1px solid currentColor;
				}

				.gap-value {
					font-size: 18px;
				}

				.gap-label {
					opacity: 0.7;
				}

				.below-resolution .gap-value {
					opacity: 0.45;
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

				tr.churn-header td {
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

				/*
				  The measured tree lives in the document so attribute writes
				  invalidate a real subtree; it is clipped rather than hidden
				  because display:none would skip that invalidation entirely.
				*/
				.target {
					height: 4px;
					overflow: hidden;
					contain: strict;
					opacity: 0.35;
				}
			</style>

			<div class="controls">
				<button onclick="${runAllShapes}" disabled="${isRunning}">
					run ${COMMIT_SHAPES.length} shapes
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
				gaps.length === 0 && !registryLookup
					? html``
					: html`
							<div class="gaps">
								${
									registryLookup
										? html`
												<div>
													<div class="gap-value">
														${registryLookup.nanosecondsPerLookup.toFixed(1)}
														ns/lookup
													</div>
													<div class="gap-label">
														customElements.get — B4's ceiling, timed alone
													</div>
												</div>
											`
										: html``
								}
								${gaps.map(
									(gap) => html`
										<div
											class="${gap.isBelowResolution ? "below-resolution" : ""}"
										>
											<div class="gap-value">
												${gap.nanosecondsPerCommit.toFixed(1)}
												ns/commit${
													gap.isBelowResolution ? " · under resolution" : ""
												}
											</div>
											<div class="gap-label">${gap.name} — ${gap.question}</div>
										</div>
									`,
								)}
							</div>
						`
			}
			${
				results.length === 0
					? html``
					: html`
							<table>
								<thead>
									<tr>
										<th>lane</th>
										<th>bindings</th>
										<th>updates/pass</th>
										<th>best pass ms</th>
										<th>ns/commit</th>
										<th>B/commit</th>
										<th>vs baseline</th>
									</tr>
								</thead>
								<tbody>
									${churnsInOrder().map(
										(churn) => html`
											<tr class="churn-header">
												<td colspan="7">
													${churn} ·
													${
														churn === "unchanged"
															? "the gate closes: hash only"
															: "the gate opens: hash, compose, write"
													}
												</td>
											</tr>
											${results
												.filter((result) => result.churn === churn)
												.map((result) => {
													const previous = baselineFor(result.name);
													return html`
														<tr title="${result.hypothesis}">
															<td>
																${result.lane}${
																	result.voidReasons.length === 0
																		? html``
																		: html`<span class="void-warning">
																				· VOID:
																				${result.voidReasons.join(", ")}</span
																			>`
																}
															</td>
															<td>${result.bindingsPerTemplate}</td>
															<td>${result.updatesPerPass}</td>
															<td>${result.bestPassMs.toFixed(2)}</td>
															<td>${result.nanosecondsPerCommit.toFixed(1)}</td>
															<td>
																${
																	result.heapGrowthBytesPerCommit === null
																		? "—"
																		: result.heapGrowthBytesPerCommit.toFixed(1)
																}
															</td>
															<td
																class="${
																	previous
																		? isBeyondResolution(
																				result.nanosecondsPerCommit,
																				previous.nanosecondsPerCommit,
																			)
																			? "beyond-resolution"
																			: "within-resolution"
																		: ""
																}"
															>
																${
																	previous
																		? formatDelta(
																				result.nanosecondsPerCommit,
																				previous.nanosecondsPerCommit,
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

			<div class="target" aria-hidden="true"></div>
		`;
	}),
);
