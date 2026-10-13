/*
    Measurement half of the parser bench. No DOM, no rendering: it calls
    getParsedTemplate directly, because a parse is a rounding error inside a
    mount and would not be visible through the render path. End-to-end cost
    belongs to pages/perf.

    What this can resolve, from an A/A run of the equivalent playwright rig
    against identical code: best-of-N work to about 8%, retained heap to about
    23%. Cold and compile cost are not resolvable in a warm page at all and are
    deliberately absent — they are read from the parser's gzip size instead.
*/

import { getParsedTemplate } from "../../lib/src/parser/html";
import {
	type CorpusShape,
	createFreshTemplateStringsArrays,
	type GeneratedCorpus,
} from "./parser-corpus";
import { readHeapMb } from "./measure";

/*
    performance.now() is clamped to 100µs, so a pass has to be milliseconds long
    to be readable. Sized so the cheapest shape still runs ~7ms, which puts the
    clock's granularity two orders of magnitude below the reading; the heaviest
    shape holds under 20MB of parsed output alive per pass, below where major
    collections start landing inside the timed region.
*/
const TARGET_CHARACTERS_PER_PASS = 2_000_000;

/** A single parsed corpus retains well under the heap reading's granularity. */
const RETAINED_COPIES = 20;

/*
    Best-of-N assumes interference can only ever add time to a pass. A best that
    far under the median means one pass measured something the others did not,
    so the row is not a number. Two is a wide threshold on purpose: an unthrottled
    run holds every shape under 1.2.
*/
const LARGEST_TRUSTED_MEDIAN_TO_BEST_RATIO = 2;

export type VoidReason = "cache hit" | "unstable timing";

export interface ShapeResult {
	name: string;
	group: string;
	holeKind: string;
	templateCount: number;
	charactersPerTemplate: number;
	totalCharacters: number;
	totalHoles: number;
	repeatsPerPass: number;
	bestPassMs: number;
	medianPassMs: number;
	nanosecondsPerCharacter: number;
	nanosecondsPerHole: number | null;
	microsecondsPerTemplate: number;
	retainedBytesPerTemplate: number | null;
	/** Non-empty means the row is not evidence of anything. */
	voidReasons: Array<VoidReason>;
}

export interface RunOptions {
	passes: number;
	measureRetainedHeap: boolean;
}

const median = (samples: ReadonlyArray<number>): number => {
	const sorted = samples.slice().sort((left, right) => left - right);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
};

const collectGarbage = (): void => {
	const collect = (globalThis as { gc?: () => void }).gc;
	if (!collect) return;
	// V8 lags on recent garbage; one call is routinely not enough.
	collect();
	collect();
	collect();
};

const yieldToBrowser = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

/*
    The whole measurement is void if the parse cache ever hits, so this proves
    two fresh wrappers around the same strings parse twice rather than trusting
    that they do.
*/
const verifyCacheStaysCold = (corpus: GeneratedCorpus): boolean => {
	const [first, second] = createFreshTemplateStringsArrays(corpus, 2);
	return getParsedTemplate(first) !== getParsedTemplate(second);
};

const findVoidReasons = (
	cacheStayedCold: boolean,
	bestPassMs: number,
	medianPassMs: number,
): Array<VoidReason> => {
	const reasons: Array<VoidReason> = [];
	if (!cacheStayedCold) reasons.push("cache hit");
	if (medianPassMs > bestPassMs * LARGEST_TRUSTED_MEDIAN_TO_BEST_RATIO)
		reasons.push("unstable timing");
	return reasons;
};

/*
    Twenty parsed corpora cannot retain nothing. Zero means performance.memory
    answered out of the same coarse bucket twice, which is what a run without
    --enable-precise-memory-info looks like; negative means a collection landed
    between the two readings. Either way there is no reading, and that is a lost
    column rather than a lost row — the pass times are untouched by it.
*/
const rejectImpossibleReading = (
	retainedBytesPerTemplate: number | null,
): number | null =>
	retainedBytesPerTemplate !== null && retainedBytesPerTemplate > 0
		? retainedBytesPerTemplate
		: null;

let parseChecksum = 0;

const parseAll = (arrays: ReadonlyArray<TemplateStringsArray>): void => {
	for (let index = 0; index < arrays.length; index++) {
		parseChecksum += getParsedTemplate(arrays[index]).bindings.length;
	}
};

const measureRetainedBytesPerTemplate = (
	corpus: GeneratedCorpus,
): number | null => {
	collectGarbage();
	const before = readHeapMb();
	if (before === null) return null;

	const held: Array<unknown> = [];
	const arrays = createFreshTemplateStringsArrays(corpus, RETAINED_COPIES);
	for (let index = 0; index < arrays.length; index++) {
		held.push(getParsedTemplate(arrays[index]));
	}

	collectGarbage();
	const after = readHeapMb();
	// `held` has to outlive the reading or the thing being measured is gone.
	const heldCount = held.length;
	held.length = 0;
	if (after === null || heldCount === 0) return null;

	return ((after - before) * 1_000_000) / heldCount;
};

export const runShape = async (
	corpus: GeneratedCorpus,
	options: RunOptions,
): Promise<ShapeResult> => {
	const shape: CorpusShape = corpus.shape;
	const repeatsPerPass = Math.max(
		1,
		Math.ceil(TARGET_CHARACTERS_PER_PASS / Math.max(1, corpus.totalCharacters)),
	);
	const cacheStayedCold = verifyCacheStaysCold(corpus);
	const passDurations: Array<number> = [];

	for (let pass = 0; pass < options.passes; pass++) {
		const arrays = createFreshTemplateStringsArrays(corpus, repeatsPerPass);
		const start = performance.now();
		parseAll(arrays);
		passDurations.push(performance.now() - start);
		if ((pass & 7) === 7) await yieldToBrowser();
	}

	const bestPassMs = Math.min(...passDurations);
	const medianPassMs = median(passDurations);
	const templatesPerPass = corpus.templates.length * repeatsPerPass;
	const charactersPerPass = corpus.totalCharacters * repeatsPerPass;
	const holesPerPass = corpus.totalHoles * repeatsPerPass;

	const retainedBytesPerTemplate = options.measureRetainedHeap
		? measureRetainedBytesPerTemplate(corpus)
		: null;
	collectGarbage();

	return {
		name: shape.name,
		group: shape.group,
		holeKind: shape.holeKind,
		templateCount: corpus.templates.length,
		charactersPerTemplate: Math.round(
			corpus.totalCharacters / corpus.templates.length,
		),
		totalCharacters: corpus.totalCharacters,
		totalHoles: corpus.totalHoles,
		repeatsPerPass,
		bestPassMs,
		medianPassMs,
		nanosecondsPerCharacter: (bestPassMs * 1_000_000) / charactersPerPass,
		nanosecondsPerHole:
			holesPerPass === 0 ? null : (bestPassMs * 1_000_000) / holesPerPass,
		microsecondsPerTemplate: (bestPassMs * 1000) / templatesPerPass,
		retainedBytesPerTemplate: rejectImpossibleReading(retainedBytesPerTemplate),
		voidReasons: findVoidReasons(cacheStayedCold, bestPassMs, medianPassMs),
	};
};

// --- derived: the two numbers the hole-density series exists to produce ---

export interface HoleCostFit {
	series: string;
	scannerNanosecondsPerCharacter: number;
	nanosecondsPerHole: number;
	pointCount: number;
}

/*
    Least squares of nanoseconds-per-template against holes-per-template across
    a series that holds characters fixed. The intercept is what the scanner
    costs with no holes at all; the slope is what one hole adds, which is the
    number the pooled parser buffers exist to defend.

    Void rows are dropped here rather than at the call site: a fit is the one
    place a single bad row disappears into a headline number.
*/
export const fitHoleCost = (
	series: string,
	seriesResults: ReadonlyArray<ShapeResult>,
): HoleCostFit | null => {
	const results = seriesResults.filter(
		(result) => result.voidReasons.length === 0,
	);
	if (results.length < 2) return null;

	const holeCounts = results.map(
		(result) => result.totalHoles / result.templateCount,
	);
	const nanosecondsPerTemplate = results.map(
		(result) => result.microsecondsPerTemplate * 1000,
	);
	const meanHoles =
		holeCounts.reduce((sum, value) => sum + value, 0) / holeCounts.length;
	const meanNanoseconds =
		nanosecondsPerTemplate.reduce((sum, value) => sum + value, 0) /
		nanosecondsPerTemplate.length;

	let covariance = 0;
	let variance = 0;
	for (let index = 0; index < holeCounts.length; index++) {
		const holeDelta = holeCounts[index] - meanHoles;
		covariance += holeDelta * (nanosecondsPerTemplate[index] - meanNanoseconds);
		variance += holeDelta * holeDelta;
	}
	if (variance === 0) return null;

	const slope = covariance / variance;
	const intercept = meanNanoseconds - slope * meanHoles;
	const charactersPerTemplate = results[0].charactersPerTemplate;

	return {
		series,
		scannerNanosecondsPerCharacter: intercept / charactersPerTemplate,
		nanosecondsPerHole: slope,
		pointCount: results.length,
	};
};

export const readParseChecksum = (): number => parseChecksum;
