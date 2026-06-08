#!/usr/bin/env node
/*
p75 regression gate for vitest bench `--outputJson` reports.

why p75 instead of vitest's built-in hz/mean compare: a mid-sample GC pause lands a few
multi-millisecond outliers into a stream of microsecond ops, which drags `mean`/`hz` (and
inflates `rme`) while the bulk of the distribution doesn't move. p75 reads the bulk, so a
clean run and a GC-spiked run of the SAME code compare equal. mean does not.

why a noise threshold instead of flagging any delta: even pinned to one core this host has
a ~4% process-to-process floor (measured). we only call a regression when the p75 delta
exceeds the combined relative margin of error of the two runs, or a fixed floor, whichever
is larger — so the gate fails on signal, not on jitter.

usage: node scripts/bench-compare.mjs <baseline.json> <current.json> [--floor=5]
exit 0 = no regression past threshold; exit 1 = at least one regression (CI gate).
*/
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const floorArg = args.find((a) => a.startsWith("--floor="));
//percent; defaults above the measured pinned noise floor so jitter never trips the gate
const FLOOR_PERCENT = floorArg ? Number(floorArg.slice("--floor=".length)) : 5;

if (files.length !== 2) {
	console.error("usage: node scripts/bench-compare.mjs <baseline.json> <current.json> [--floor=5]");
	process.exit(2);
}

//key every benchmark by its group path + case name — the pair vitest guarantees unique
const index = (path) => {
	const report = JSON.parse(readFileSync(path, "utf8"));
	const byKey = new Map();
	for (const file of report.files) {
		for (const group of file.groups) {
			for (const bench of group.benchmarks) {
				byKey.set(`${group.fullName} › ${bench.name}`, {
					p75: bench.p75,
					rme: bench.rme,
				});
			}
		}
	}
	return byKey;
};

const [baseline, current] = [index(files[0]), index(files[1])];

const regressions = [];
const improvements = [];
const steady = [];
const added = [];
const removed = [];

for (const [key, cur] of current) {
	const base = baseline.get(key);
	if (!base) {
		added.push(key);
		continue;
	}
	if (base.p75 <= 0) continue;

	const deltaPercent = ((cur.p75 - base.p75) / base.p75) * 100;
	//rme is a per-run margin on the mean; we borrow it as the run's stability estimate and
	//combine the two runs in quadrature, then never trust a window tighter than the floor
	const combinedRme = Math.hypot(base.rme, cur.rme);
	const threshold = Math.max(FLOOR_PERCENT, combinedRme);

	const row = { key, deltaPercent, threshold };
	if (deltaPercent > threshold) regressions.push(row);
	else if (deltaPercent < -threshold) improvements.push(row);
	else steady.push(row);
}

for (const key of baseline.keys()) if (!current.has(key)) removed.push(key);

const pct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const line = (r) => `  ${pct(r.deltaPercent).padStart(7)}  (±${r.threshold.toFixed(1)}% noise)  ${r.key}`;

if (regressions.length) {
	console.log(`\n✗ REGRESSIONS — p75 slower than baseline beyond noise (${regressions.length}):`);
	regressions.sort((a, b) => b.deltaPercent - a.deltaPercent).forEach((r) => console.log(line(r)));
}
if (improvements.length) {
	console.log(`\n✓ improvements (${improvements.length}):`);
	improvements.sort((a, b) => a.deltaPercent - b.deltaPercent).forEach((r) => console.log(line(r)));
}
console.log(`\n${steady.length} within noise · ${added.length} new · ${removed.length} removed`);
if (added.length) console.log(`  new:     ${added.join(", ")}`);
if (removed.length) console.log(`  removed: ${removed.join(", ")}`);

process.exit(regressions.length ? 1 : 0);
