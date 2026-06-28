import { html, render } from "../../../lib/src";
import {
	type Baseline,
	clearBaseline,
	formatDelta,
	loadBaseline,
	measureOperation,
	type Operation,
	type OperationResult,
	saveBaseline,
} from "../measure";

/*
    Krausest-style benchmark harness. Runs the canonical
    js-framework-benchmark operation suite (create, replace, partial update,
    select, swap, remove, append, clear) against the renderer.

    All measurement (paint-gated timing, DOM-mutation count, baseline/delta)
    comes from the shared ../measure harness — the executable form of the
    "Measuring" contract in lib/CONVENTIONS.md. This component only defines the
    operations and renders the results.

    "Run suite" executes every op a configurable number of times (with one
    warmup) and records the median. Results can be frozen as a baseline in
    localStorage; subsequent runs render a delta % column against it so
    regressions are visible without leaving the page.
*/

type Row = { identifier: number; label: string };

const ADJECTIVES = [
	"pretty",
	"large",
	"big",
	"small",
	"tall",
	"short",
	"long",
	"handsome",
	"plain",
	"quaint",
	"clean",
	"elegant",
	"easy",
	"angry",
	"crazy",
	"helpful",
	"mushy",
	"odd",
	"unsightly",
	"adorable",
	"important",
	"inexpensive",
	"cheap",
	"expensive",
	"fancy",
];

const COLORS = [
	"red",
	"yellow",
	"blue",
	"green",
	"pink",
	"brown",
	"purple",
	"black",
	"white",
	"orange",
];

const NOUNS = [
	"table",
	"chair",
	"house",
	"bbq",
	"desk",
	"car",
	"pony",
	"cookie",
	"sandwich",
	"burger",
	"pizza",
	"mouse",
	"keyboard",
];

const pickRandom = <T>(items: ReadonlyArray<T>): T =>
	items[Math.floor(Math.random() * items.length)];

const BASELINE_STORAGE_KEY = "grundlage:krausest:baseline";

customElements.define(
	"krausest-bench",
	render(function* (element) {
		let rows: Array<Row> = [];
		let selectedIdentifier: number | null = null;
		let nextIdentifier = 1;
		let sampleCount = Number(element.getAttribute("samples") ?? 10);
		let isRunning = false;
		let activeOperation: string | null = null;
		const measurements = new Map<string, OperationResult>();
		const itemCounts = new Map<string, number>();
		let baseline: Baseline<OperationResult[]> | null =
			loadBaseline<OperationResult[]>(BASELINE_STORAGE_KEY);

		const buildLabel = () =>
			`${pickRandom(ADJECTIVES)} ${pickRandom(COLORS)} ${pickRandom(NOUNS)}`;

		const buildRows = (count: number): Array<Row> => {
			const next = new Array<Row>(count);
			for (let index = 0; index < count; index++) {
				next[index] = { identifier: nextIdentifier++, label: buildLabel() };
			}
			return next;
		};

		// Each op returns a function that mutates `rows` (and possibly selection)
		// to its target state. Preconditions (e.g. "partial update needs 1000
		// rows") are handled per-op so the suite can run them in any order.
		const operations: Array<{
			label: string;
			prepare: () => void;
			apply: () => void;
		}> = [
			{
				label: "create 1k",
				prepare: () => {
					rows = [];
					selectedIdentifier = null;
				},
				apply: () => {
					rows = buildRows(1000);
				},
			},
			{
				label: "replace 1k",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					rows = buildRows(1000);
				},
			},
			{
				label: "partial update (every 10th of 1k)",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					for (let index = 0; index < rows.length; index += 10) {
						rows[index] = {
							identifier: rows[index].identifier,
							label: `${rows[index].label} !!!`,
						};
					}
				},
			},
			{
				label: "select row",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					selectedIdentifier = rows[Math.floor(rows.length / 2)].identifier;
				},
			},
			{
				label: "swap rows (1 ↔ 998)",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					if (rows.length < 999) return;
					const temporary = rows[1];
					rows[1] = rows[998];
					rows[998] = temporary;
				},
			},
			{
				label: "remove row",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					rows.splice(Math.floor(rows.length / 2), 1);
				},
			},
			{
				label: "create 10k",
				prepare: () => {
					rows = [];
					selectedIdentifier = null;
				},
				apply: () => {
					rows = buildRows(10000);
				},
			},
			{
				label: "append 1k to 1k",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					const more = buildRows(1000);
					for (let index = 0; index < more.length; index++)
						rows.push(more[index]);
				},
			},
			{
				label: "clear",
				prepare: () => {
					rows = buildRows(1000);
					selectedIdentifier = null;
				},
				apply: () => {
					rows = [];
				},
			},
		];

		// Observe only the list, not the harness chrome, so mutation counts
		// reflect the op under test. The list container is structurally stable
		// across renders; fall back to the shadow root before the first paint.
		const listRoot = (): Node =>
			element.shadowRoot?.querySelector(".list-shell") ??
			element.shadowRoot ??
			element;

		// Wrap a domain op as a measurable one: apply mutates state AND triggers
		// the render (the harness times to paint), and records the painted count.
		const measurableOf = (op: (typeof operations)[number]): Operation => ({
			label: op.label,
			prepare: () => {
				op.prepare();
				element.update();
			},
			apply: () => {
				const before = rows.length;
				op.apply();
				itemCounts.set(op.label, Math.max(before, rows.length));
				element.update();
			},
		});

		const runOperation = async (op: (typeof operations)[number]) => {
			if (isRunning) return;
			isRunning = true;
			activeOperation = op.label;
			element.update();

			const result = await measureOperation(listRoot(), measurableOf(op), {
				samples: sampleCount,
			});
			measurements.set(op.label, result);

			isRunning = false;
			activeOperation = null;
			element.update();
		};

		const runSuite = async () => {
			if (isRunning) return;
			measurements.clear();
			for (let index = 0; index < operations.length; index++) {
				await runOperation(operations[index]);
			}
			// eslint-disable-next-line no-console
			console.log(
				"[krausest] suite results",
				JSON.stringify(
					{
						capturedAt: new Date().toISOString(),
						results: Array.from(measurements.values()),
					},
					null,
					2,
				),
			);
		};

		const promoteToBaseline = () => {
			if (measurements.size === 0) return;
			baseline = saveBaseline(
				BASELINE_STORAGE_KEY,
				Array.from(measurements.values()),
			);
			element.update();
		};

		const dropBaseline = () => {
			baseline = null;
			clearBaseline(BASELINE_STORAGE_KEY);
			element.update();
		};

		const formatMs = (value: number) => value.toFixed(2);

		const baselineFor = (label: string): OperationResult | undefined =>
			baseline?.value.find((entry) => entry.label === label);

		yield () => html`
			<style>
				:host {
					display: block;
					font: 13px monospace;
				}

				.controls {
					display: flex;
					flex-wrap: wrap;
					gap: 8px;
					align-items: center;
				}

				.controls + .controls {
					margin-top: 6px;
				}

				button {
					padding: 6px 12px;
					font: inherit;
					cursor: pointer;
				}

				button[disabled] {
					opacity: 0.5;
					cursor: progress;
				}

				.status {
					margin-top: 8px;
					color: #555;
					min-height: 1.2em;
				}

				.results {
					margin-top: 12px;
					display: grid;
					grid-template-columns: max-content repeat(6, max-content);
					gap: 4px 24px;
				}

				.results > div {
					padding: 2px 0;
					text-align: right;
					border-bottom: 1px solid #eee;
				}

				.results > div.label {
					text-align: left;
				}

				.results > div.head {
					font-weight: bold;
					border-bottom-color: #333;
				}

				.delta {
					display: flex;
					flex-direction: column;
					align-items: flex-end;
					gap: 2px;
				}

				.regress {
					color: #b00020;
				}

				.improve {
					color: #006a2b;
				}

				table {
					margin-top: 16px;
					border-collapse: collapse;
					width: 100%;
					max-width: 480px;
				}

				td {
					padding: 2px 6px;
					font-size: 11px;
					line-height: 14px;
					border-bottom: 1px solid #eee;
				}

				tr.selected td {
					background: #fffbcc;
				}

				.list-shell {
					max-height: 320px;
					overflow: auto;
					border: 1px solid #ddd;
					contain: strict;
					height: 320px;
				}
			</style>

			<div class="controls">
				<button onclick="${runSuite}" disabled="${isRunning}">run suite</button>
				${operations.map(
					(op) => html`
						<button onclick="${() => runOperation(op)}" disabled="${isRunning}">
							${op.label}
						</button>
					`,
				)}
			</div>

			<div class="controls">
				samples per op:
				<input
					type="number"
					min="1"
					max="50"
					value="${sampleCount}"
					oninput="${(event: Event) => {
						const next = Number((event.target as HTMLInputElement).value);
						if (Number.isFinite(next) && next > 0) {
							sampleCount = next;
						}
					}}"
				/>
				<button
					onclick="${promoteToBaseline}"
					disabled="${measurements.size === 0 || isRunning}"
				>
					save as baseline
				</button>
				<button onclick="${dropBaseline}" disabled="${!baseline || isRunning}">
					clear baseline
				</button>
				${baseline
					? html`<span>baseline captured ${baseline.capturedAt}</span>`
					: html`<span>no baseline saved</span>`}
			</div>

			<div class="status">
				${isRunning
					? html`running: ${activeOperation ?? "suite"}…`
					: html`idle`}
			</div>

			${measurements.size > 0
				? html`
						<div class="results">
							<div class="label head">operation</div>
							<div class="head">items</div>
							<div class="head">median (ms)</div>
							<div class="head">min</div>
							<div class="head">max</div>
							<div class="head">DOM writes</div>
							<div class="head">vs baseline</div>
							${Array.from(measurements.values()).map((measurement) => {
								const previous = baselineFor(measurement.label);
								// ms uses a 2% noise band; DOM writes are deterministic, so
								// compare them exactly — any drift is a real false-write signal.
								const msClass = !previous
									? ""
									: measurement.medianMs > previous.medianMs * 1.02
										? "regress"
										: measurement.medianMs < previous.medianMs * 0.98
											? "improve"
											: "";
								const writesClass = !previous
									? ""
									: measurement.medianMutations > previous.medianMutations
										? "regress"
										: measurement.medianMutations < previous.medianMutations
											? "improve"
											: "";
								return html`
									<div class="label">${measurement.label}</div>
									<div>${itemCounts.get(measurement.label) ?? "—"}</div>
									<div>${formatMs(measurement.medianMs)}</div>
									<div>${formatMs(measurement.minMs)}</div>
									<div>${formatMs(measurement.maxMs)}</div>
									<div>${measurement.medianMutations}</div>
									<div class="delta">
										${previous
											? html`
													<span class="${msClass}"
														>${formatDelta(
															measurement.medianMs,
															previous.medianMs,
														)}
														ms</span
													>
													<span class="${writesClass}"
														>${formatDelta(
															measurement.medianMutations,
															previous.medianMutations,
														)}
														writes</span
													>
												`
											: "—"}
									</div>
								`;
							})}
						</div>
					`
				: html``}

			<div class="list-shell">
				<table>
					<tbody>
						${rows.map(
							(row) => html`
								<tr
									data-key="${row.identifier}"
									class="${row.identifier === selectedIdentifier
										? "selected"
										: ""}"
								>
									<td>${row.identifier}</td>
									<td>${row.label}</td>
								</tr>
							`,
						)}
					</tbody>
				</table>
			</div>
		`;
	}),
);
