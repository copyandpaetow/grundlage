import { html, component } from "../../../lib/src";

/*
    Measures how expensive list reorders are with the current reconciliation
    algorithm. Focus is on shapes that hit the O(n) isAlreadyInPosition walk:
    reverse, shuffle, rotate. "mutate" keeps order stable so the monotonic
    short-circuit fires — use it as the lower bound.
*/

type Measurement = {
	label: string;
	itemCount: number;
	lastDurationMs: number;
	averageDurationMs: number;
	sampleCount: number;
};

type Row = { identifier: number; value: number };

const buildRows = (count: number): Array<Row> => {
	const rows = new Array<Row>(count);
	for (let index = 0; index < count; index++) {
		rows[index] = { identifier: index, value: index };
	}
	return rows;
};

const reverseInPlace = (rows: Array<Row>) => {
	let left = 0;
	let right = rows.length - 1;
	while (left < right) {
		const swapLeft = rows[left];
		rows[left] = rows[right];
		rows[right] = swapLeft;
		left++;
		right--;
	}
};

const shuffleInPlace = (rows: Array<Row>) => {
	for (let index = rows.length - 1; index > 0; index--) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		const swapValue = rows[index];
		rows[index] = rows[swapIndex];
		rows[swapIndex] = swapValue;
	}
};

const rotateOne = (rows: Array<Row>) => {
	if (rows.length < 2) return;
	const first = rows.shift() as Row;
	rows.push(first);
};

const swapEnds = (rows: Array<Row>) => {
	if (rows.length < 2) return;
	const lastIndex = rows.length - 1;
	const swapValue = rows[0];
	rows[0] = rows[lastIndex];
	rows[lastIndex] = swapValue;
};

const mutateValues = (rows: Array<Row>) => {
	for (let index = 0; index < rows.length; index++) {
		rows[index] = { identifier: rows[index].identifier, value: Math.random() };
	}
};

customElements.define(
	"reorder-stress",
	component(function* (element) {
		let itemCount = Number(element.getAttribute("items") ?? 1000);
		let rows: Array<Row> = buildRows(itemCount);
		const measurements = new Map<string, Measurement>();

		const runOperation = (
			label: string,
			operation: (rows: Array<Row>) => void,
		) => {
			operation(rows);
			const startTime = performance.now();
			element.update();
			const durationMs = performance.now() - startTime;

			const previous = measurements.get(label);
			const sampleCount = (previous?.sampleCount ?? 0) + 1;
			const cumulativeMs =
				(previous?.averageDurationMs ?? 0) * (sampleCount - 1) + durationMs;
			measurements.set(label, {
				label,
				itemCount: rows.length,
				lastDurationMs: durationMs,
				averageDurationMs: cumulativeMs / sampleCount,
				sampleCount,
			});
			element.update();
		};

		const resize = (nextCount: number) => {
			itemCount = nextCount;
			rows = buildRows(itemCount);
			measurements.clear();
			element.update();
		};

		const formatMs = (value: number) => value.toFixed(2);

		yield () => html`
			<style>
				:host {
					display: block;
					font: 13px monospace;
				}

				menu {
					display: flex;
					flex-wrap: wrap;
					gap: 8px;
					padding: 0;
				}

				button {
					padding: 6px 12px;
					font: inherit;
					cursor: pointer;
				}

				.sizes {
					margin-top: 8px;
					display: flex;
					gap: 8px;
					align-items: center;
				}

				.results {
					margin-top: 12px;
					display: grid;
					grid-template-columns: max-content repeat(4, max-content);
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

				ul {
					margin-top: 16px;
					padding: 0;
					list-style: none;
					max-height: 240px;
					overflow: auto;
					border: 1px solid #ddd;
					contain: strict;
					height: 240px;
				}

				li {
					padding: 2px 6px;
					font-size: 11px;
					line-height: 14px;
					height: 14px;
				}
			</style>

			<menu>
				<button onclick="${() => runOperation("reverse", reverseInPlace)}">
					reverse
				</button>
				<button onclick="${() => runOperation("shuffle", shuffleInPlace)}">
					shuffle
				</button>
				<button onclick="${() => runOperation("rotate", rotateOne)}">
					rotate 1
				</button>
				<button onclick="${() => runOperation("swap ends", swapEnds)}">
					swap ends
				</button>
				<button onclick="${() => runOperation("mutate", mutateValues)}">
					mutate values
				</button>
			</menu>

			<div class="sizes">
				size:
				<button onclick="${() => resize(100)}">100</button>
				<button onclick="${() => resize(500)}">500</button>
				<button onclick="${() => resize(1000)}">1000</button>
				<button onclick="${() => resize(5000)}">5000</button>
				<span>current: ${rows.length}</span>
			</div>

			${
				measurements.size > 0
					? html`
							<div class="results">
								<div class="label head">operation</div>
								<div class="head">items</div>
								<div class="head">last (ms)</div>
								<div class="head">avg (ms)</div>
								<div class="head">samples</div>
								${Array.from(measurements.values()).map(
									(measurement) => html`
										<div class="label">${measurement.label}</div>
										<div>${measurement.itemCount}</div>
										<div>${formatMs(measurement.lastDurationMs)}</div>
										<div>${formatMs(measurement.averageDurationMs)}</div>
										<div>${measurement.sampleCount}</div>
									`,
								)}
							</div>
						`
					: html``
			}

			<ul>
				${rows.map(
					(row) =>
						html`<li data-key=${row.identifier}>
							#${row.identifier} → ${row.value}
						</li>`,
				)}
			</ul>
		`;
	}),
);
