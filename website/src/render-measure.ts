/*
    Measurement half of the render bench. It calls patchInstance directly on a
    mounted instance: no driver, no microtask, no rAF, no paint. The unit is one
    live-binding commit, which is where every open perf item on
    _findings/parsing-and-bindings.md lives. End-to-end frame cost belongs to
    pages/perf, the same split the parser bench draws.

    What a pass does NOT include: style recalc and layout. A pass never yields,
    so the browser marks the tree dirty and recalculates after the pass has been
    timed. That is deliberate — a commit-path change moves JS work, and mixing
    recalc in would bury it under a cost the change cannot touch. It also means
    these numbers are not frame budget; they are the JS half of it.
*/

import { getParsedTemplate } from "../../lib/src/parser/html";
import {
	type Instance,
	mountInstance,
	patchInstance,
} from "../../lib/src/rendering/instance";
//the internal html, not the branded public one: this file is already below that surface
import { html } from "../../lib/src/template";
import { readHeapMb } from "./measure";
import {
	type CommitShape,
	DECLARED_PROP_NAME,
	generateShape,
	type GeneratedShape,
} from "./render-shapes";

/*
    performance.now() is clamped to 100µs, so a pass has to be milliseconds long
    to be readable. Passes are sized by calibration rather than by a fixed commit
    count because the lanes are two orders of magnitude apart: a closed gate and
    a four-key spread diff do not belong on the same schedule.
*/
const TARGET_PASS_MS = 8;
const SHORTEST_READABLE_CALIBRATION_MS = 2;

/*
    Best-of-N assumes interference can only ever add time to a pass. A best that
    far under the median means one pass measured something the others did not.
*/
const LARGEST_TRUSTED_MEDIAN_TO_BEST_RATIO = 2;

export type VoidReason =
	| "gate did not open"
	| "gate did not close"
	| "unstable timing"
	| "pass too short";

export interface ShapeResult {
	name: string;
	lane: string;
	churn: string;
	hypothesis: string;
	bindingsPerTemplate: number;
	updatesPerPass: number;
	commitsPerPass: number;
	bestPassMs: number;
	medianPassMs: number;
	nanosecondsPerCommit: number;
	/** Best-effort and a lower bound; null when the heap reading is unusable. */
	heapGrowthBytesPerCommit: number | null;
	/** Non-empty means the row is not evidence of anything. */
	voidReasons: Array<VoidReason>;
}

export interface RunOptions {
	passes: number;
	measureHeapGrowth: boolean;
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

interface MountedShape {
	generated: GeneratedShape;
	instance: Instance;
	container: Element;
}

const mountShape = (
	generated: GeneratedShape,
	container: Element,
): MountedShape => {
	const { templateStrings, valuesByParity } = generated;
	const { instance, fragment } = mountInstance(
		html(templateStrings, ...valuesByParity[0]),
		getParsedTemplate(templateStrings),
		{ needsStyleSheetRefreshOnMove: false },
	);
	container.replaceChildren(fragment);
	return { generated, instance, container };
};

const runPass = (mounted: MountedShape, updates: number): number => {
	const [first, second] = mounted.generated.valuesByParity;
	const { instance } = mounted;
	const start = performance.now();
	for (let update = 0; update < updates; update++)
		patchInstance(instance, (update & 1) === 0 ? first : second);
	return performance.now() - start;
};

/** Calibration sizes against a best-of, because the metric it feeds is a best-of. */
const CALIBRATION_TRIES = 3;

const bestPassOf = (mounted: MountedShape, updates: number): number => {
	let best = Infinity;
	for (let attempt = 0; attempt < CALIBRATION_TRIES; attempt++)
		best = Math.min(best, runPass(mounted, updates));
	return best;
};

/*
    A cold pass reads long and would undersize every pass that follows it, so
    the first reading at each size is thrown away. Refinement continues until
    the pass lands near the target: the first scale factor comes off a pass far
    shorter than the target, where per-pass fixed cost is a much larger share of
    the reading.
*/
const calibrateUpdatesPerPass = (mounted: MountedShape): number => {
	let updates = 4;
	for (let attempt = 0; attempt < 24; attempt++) {
		runPass(mounted, updates);
		const best = bestPassOf(mounted, updates);
		if (best < SHORTEST_READABLE_CALIBRATION_MS) {
			updates *= 4;
			continue;
		}
		if (best >= TARGET_PASS_MS * 0.75 && best <= TARGET_PASS_MS * 2)
			return updates;
		updates = Math.max(1, Math.round(updates * (TARGET_PASS_MS / best)));
	}
	return updates;
};

/*
    A declared prop is assigned to the element rather than written to markup, so
    a MutationObserver sees a closed gate and an open one as the same nothing.
    Reading the property back is the only proof for that lane.
*/
const readObservableState = (mounted: MountedShape): string =>
	mounted.generated.shape.lane === "declaredPropAttribute"
		? Array.from(mounted.container.children, (child) =>
				String(
					(child as unknown as Record<string, unknown>)[DECLARED_PROP_NAME],
				),
			).join(",")
		: mounted.container.innerHTML;

/*
    Proves the churn axis is real before anything is timed. "unchanged" that
    still writes is measuring a hash collision or a leaky gate; "changing" that
    writes nothing is measuring an early return.
*/
const observableStateMovesOnSecondParity = (mounted: MountedShape): boolean => {
	const before = readObservableState(mounted);
	patchInstance(mounted.instance, mounted.generated.valuesByParity[1]);
	return readObservableState(mounted) !== before;
};

const findVoidReasons = (
	shape: CommitShape,
	stateMoved: boolean,
	bestPassMs: number,
	medianPassMs: number,
): Array<VoidReason> => {
	const reasons: Array<VoidReason> = [];
	if (shape.churn === "changing" && !stateMoved)
		reasons.push("gate did not open");
	if (shape.churn === "unchanged" && stateMoved)
		reasons.push("gate did not close");
	if (medianPassMs > bestPassMs * LARGEST_TRUSTED_MEDIAN_TO_BEST_RATIO)
		reasons.push("unstable timing");
	//calibration can size a pass off a cold reading and land far under target;
	//the pass itself is the honest check, not a cleverer calibrator
	if (bestPassMs < TARGET_PASS_MS / 2) reasons.push("pass too short");
	return reasons;
};

/*
    The first shape of a fresh page runs in a cold tier and reads 50% high, and
    the shapes after it read progressively less high — a gradient across the
    table that looks like a result. One cheap pass over every lane puts the
    whole commit path in the same tier before anything is timed.
*/
const WARM_UP_UPDATES = 60;

export const warmUpCommitShapes = (
	shapes: ReadonlyArray<CommitShape>,
	container: Element,
): void => {
	for (let index = 0; index < shapes.length; index++)
		runPass(
			mountShape(generateShape(shapes[index]), container),
			WARM_UP_UPDATES,
		);
	container.replaceChildren();
};

/*
    Heap growth over a pass, not retained size: none of what a commit allocates
    survives it. A minor collection landing inside the pass hides some of it, so
    this reads as a lower bound and a negative reading is no reading at all.
    The comparison it exists for is staticName against composedName — equal
    growth there means composing a hole-free name allocates nothing.
*/
const measureHeapGrowthBytesPerCommit = (
	mounted: MountedShape,
	updates: number,
): number | null => {
	collectGarbage();
	const before = readHeapMb();
	if (before === null) return null;
	runPass(mounted, updates);
	const after = readHeapMb();
	if (after === null) return null;
	const commits = updates * mounted.generated.shape.bindingsPerTemplate;
	const growth = ((after - before) * 1_000_000) / commits;
	return growth > 0 ? growth : null;
};

export const runCommitShape = async (
	shape: CommitShape,
	container: Element,
	options: RunOptions,
): Promise<ShapeResult> => {
	const mounted = mountShape(generateShape(shape), container);
	const stateMoved = observableStateMovesOnSecondParity(mounted);
	const updatesPerPass = calibrateUpdatesPerPass(mounted);
	const passDurations: Array<number> = [];

	for (let pass = 0; pass < options.passes; pass++) {
		passDurations.push(runPass(mounted, updatesPerPass));
		if ((pass & 7) === 7) await yieldToBrowser();
	}

	const bestPassMs = Math.min(...passDurations);
	const medianPassMs = median(passDurations);
	const commitsPerPass = updatesPerPass * shape.bindingsPerTemplate;
	const heapGrowthBytesPerCommit = options.measureHeapGrowth
		? measureHeapGrowthBytesPerCommit(mounted, updatesPerPass)
		: null;

	container.replaceChildren();
	collectGarbage();

	return {
		name: shape.name,
		lane: shape.lane,
		churn: shape.churn,
		hypothesis: shape.hypothesis,
		bindingsPerTemplate: shape.bindingsPerTemplate,
		updatesPerPass,
		commitsPerPass,
		bestPassMs,
		medianPassMs,
		nanosecondsPerCommit: (bestPassMs * 1_000_000) / commitsPerPass,
		heapGrowthBytesPerCommit,
		voidReasons: findVoidReasons(shape, stateMoved, bestPassMs, medianPassMs),
	};
};

// --- derived: the gaps the shapes exist to produce ------------------------

export interface LaneGap {
	name: string;
	question: string;
	nanosecondsPerCommit: number;
	/** True when the gap is smaller than the noise of the rows it came from. */
	isBelowResolution: boolean;
}

export interface RegistryLookupReading {
	nanosecondsPerLookup: number;
	lookups: number;
}

/*
    isDeclaredPropName cannot be subtracted out by comparing a div lane against
    a custom-element lane: Blink runs its own slower attribute path once the
    anchor is a custom element, and that path is not something a cache in this
    library can remove. So the call is timed on its own, with nothing else in
    the loop. This is B4's ceiling, exactly.
*/
let registryLookupChecksum = 0;

export const measureRegistryLookup = (
	elementName: string,
	lookups: number,
): RegistryLookupReading => {
	const start = performance.now();
	for (let index = 0; index < lookups; index++)
		if (customElements.get(elementName) !== undefined) registryLookupChecksum++;
	const elapsed = performance.now() - start;
	return {
		nanosecondsPerLookup: (elapsed * 1_000_000) / lookups,
		lookups,
	};
};

export const readRegistryLookupChecksum = (): number => registryLookupChecksum;

const gapBetween = (
	results: ReadonlyArray<ShapeResult>,
	resolutionPercent: number,
	name: string,
	question: string,
	higher: { lane: string; churn: string },
	lower: { lane: string; churn: string },
): LaneGap | null => {
	const usable = (wanted: { lane: string; churn: string }) =>
		results.find(
			(result) =>
				result.lane === wanted.lane &&
				result.churn === wanted.churn &&
				result.voidReasons.length === 0,
		);
	const above = usable(higher);
	const below = usable(lower);
	if (!above || !below) return null;
	const nanosecondsPerCommit =
		above.nanosecondsPerCommit - below.nanosecondsPerCommit;
	return {
		name,
		question,
		nanosecondsPerCommit,
		isBelowResolution:
			Math.abs(nanosecondsPerCommit) <
			(above.nanosecondsPerCommit * resolutionPercent) / 100,
	};
};

export const deriveLaneGaps = (
	results: ReadonlyArray<ShapeResult>,
	resolutionPercent: number,
): Array<LaneGap> =>
	[
		gapBetween(
			results,
			resolutionPercent,
			"hole-free nameParts",
			"P13's target: the walk and the extra combine a name with no holes still pays",
			{ lane: "staticNameAttribute", churn: "unchanged" },
			{ lane: "content", churn: "unchanged" },
		),
		gapBetween(
			results,
			resolutionPercent,
			"a hole in the name",
			"the same gate with one real hole in it, for scale",
			{ lane: "composedNameAttribute", churn: "unchanged" },
			{ lane: "staticNameAttribute", churn: "unchanged" },
		),
		gapBetween(
			results,
			resolutionPercent,
			"the attribute write",
			"what opening the gate costs over a text commit",
			{ lane: "staticNameAttribute", churn: "changing" },
			{ lane: "content", churn: "changing" },
		),
		gapBetween(
			results,
			resolutionPercent,
			"a custom element anchor",
			"registry lookup AND Blink's own custom-element attribute path: not attributable to either",
			{ lane: "customElementAttribute", churn: "changing" },
			{ lane: "staticNameAttribute", churn: "changing" },
		),
	].filter((gap): gap is LaneGap => gap !== null);
