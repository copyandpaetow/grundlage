import { html, render } from "../../../lib/src";

/*
    Measures list mutations that should hit the head/tail peel fast paths:
    push, pop, shift, unshift, and splice operations that keep both ends
    stable. "replace middle" is the one case that falls through to the
    general-middle reconciler — useful as the upper bound next to the
    peel-friendly operations below it.

    Pair with reorder-stress: that one measures the O(n) reorder walk,
    this one measures the O(1-ish) end mutations.
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

customElements.define(
	"mutation-stress",
	render(function* (element) {
		let itemCount = Number(element.getAttribute("items") ?? 1000);
		let rows: Array<Row> = buildRows(itemCount);
		let nextIdentifier = itemCount;
		const measurements = new Map<string, Measurement>();

		const mintRow = (): Row => ({
			identifier: nextIdentifier,
			value: nextIdentifier++,
		});

		const pushOne = (target: Array<Row>) => {
			target.push(mintRow());
		};

		const popOne = (target: Array<Row>) => {
			if (target.length > 0) target.pop();
		};

		const shiftOne = (target: Array<Row>) => {
			if (target.length > 0) target.shift();
		};

		const unshiftOne = (target: Array<Row>) => {
			target.unshift(mintRow());
		};

		const pushMany = (target: Array<Row>, count: number) => {
			for (let index = 0; index < count; index++) pushOne(target);
		};

		const popMany = (target: Array<Row>, count: number) => {
			for (let index = 0; index < count; index++) popOne(target);
		};

		const shiftMany = (target: Array<Row>, count: number) => {
			for (let index = 0; index < count; index++) shiftOne(target);
		};

		const unshiftMany = (target: Array<Row>, count: number) => {
			for (let index = 0; index < count; index++) unshiftOne(target);
		};

		const insertMiddle = (target: Array<Row>) => {
			const middleIndex = Math.floor(target.length / 2);
			target.splice(middleIndex, 0, mintRow());
		};

		const removeMiddle = (target: Array<Row>) => {
			if (target.length === 0) return;
			const middleIndex = Math.floor(target.length / 2);
			target.splice(middleIndex, 1);
		};

		// Hits the general-middle path: both ends peel, but the spliced region
		// forces hash-claim + structural fallback + move over a bounded range.
		const replaceMiddleRange = (target: Array<Row>, count: number) => {
			if (target.length < count) return;
			const middleIndex = Math.floor((target.length - count) / 2);
			const inserts = new Array<Row>(count);
			for (let index = 0; index < count; index++) inserts[index] = mintRow();
			target.splice(middleIndex, count, ...inserts);
		};

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
			nextIdentifier = itemCount;
			measurements.clear();
			element.update();
		};

		const formatMs = (value: number) => value.toFixed(3);

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

				menu + menu {
					margin-top: 4px;
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
				<button onclick="${() => runOperation("push", pushOne)}">push</button>
				<button onclick="${() => runOperation("pop", popOne)}">pop</button>
				<button onclick="${() => runOperation("unshift", unshiftOne)}">
					unshift
				</button>
				<button onclick="${() => runOperation("shift", shiftOne)}">
					shift
				</button>
				<button onclick="${() => runOperation("insert middle", insertMiddle)}">
					insert middle
				</button>
				<button onclick="${() => runOperation("remove middle", removeMiddle)}">
					remove middle
				</button>
			</menu>

			<menu>
				<button
					onclick="${() =>
						runOperation("push ×50", (target) => pushMany(target, 50))}"
				>
					push ×50
				</button>
				<button
					onclick="${() =>
						runOperation("pop ×50", (target) => popMany(target, 50))}"
				>
					pop ×50
				</button>
				<button
					onclick="${() =>
						runOperation("unshift ×50", (target) => unshiftMany(target, 50))}"
				>
					unshift ×50
				</button>
				<button
					onclick="${() =>
						runOperation("shift ×50", (target) => shiftMany(target, 50))}"
				>
					shift ×50
				</button>
				<button
					onclick="${() =>
						runOperation("replace middle ×10", (target) =>
							replaceMiddleRange(target, 10),
						)}"
				>
					replace middle ×10
				</button>
				<button
					onclick="${() =>
						runOperation("replace middle ×100", (target) =>
							replaceMiddleRange(target, 100),
						)}"
				>
					replace middle ×100
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

			${measurements.size > 0
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
				: html``}

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
