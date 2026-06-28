// The executable form of the "Measuring" contract in lib/CONVENTIONS.md.
//
// One shared way to measure, so a "win" is never an artifact. Every probe
// reports the same three numbers per operation/frame:
//   1. DOM mutation count   — a MutationObserver tally (the direct read of enemy #1)
//   2. wall-clock ms         — start -> mutate -> double-rAF, so paint is included
//   3. memory / heap delta   — best-effort, the coarse read of enemy #2
//
// Framework-agnostic on purpose: it knows nothing about html`` or update(). A
// probe passes an `apply` that does the work whose cost is measured (including
// whatever triggers the render); the harness times it and counts what hit the DOM.
//
// CPU throttle (our 20x old-device approximation) is a DevTools setting and must
// be enabled there; this module assumes it. Heap numbers need Chrome started with
// --enable-precise-memory-info to be byte-accurate; otherwise they round coarsely.

// --- primitives ----------------------------------------------------------

/** Resolves after the browser has committed a frame (layout + paint). */
export const waitForPaint = (): Promise<void> =>
	new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

/** Best-effort used-heap reading in MB, or null when unavailable. */
export const readHeapMb = (): number | null => {
	const memory = (
		performance as unknown as { memory?: { usedJSHeapSize: number } }
	).memory;
	return memory ? memory.usedJSHeapSize / 1_000_000 : null;
};

/** Counts real DOM changes: nodes inserted/removed + attribute + text edits. */
export interface MutationCounter {
	read(): number;
	reset(): void;
	stop(): void;
}

export const observeMutations = (root: Node): MutationCounter => {
	let count = 0;
	const tally = (records: MutationRecord[]) => {
		for (let index = 0; index < records.length; index++) {
			const record = records[index];
			if (record.type === "childList") {
				count += record.addedNodes.length + record.removedNodes.length;
			} else {
				count += 1;
			}
		}
	};
	const observer = new MutationObserver(tally);
	observer.observe(root, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});
	return {
		read: () => {
			tally(observer.takeRecords());
			return count;
		},
		reset: () => {
			observer.takeRecords();
			count = 0;
		},
		stop: () => observer.disconnect(),
	};
};

const median = (samples: ReadonlyArray<number>): number => {
	const sorted = samples.slice().sort((left, right) => left - right);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
};

// --- operation mode (discrete ops: create, swap, select, …) --------------

export interface Operation {
	label: string;
	/** Bring state to the op's starting point. Not timed. */
	prepare?: () => void | Promise<void>;
	/** The work being measured, including whatever triggers the render. */
	apply: () => void | Promise<void>;
}

export interface OperationResult {
	label: string;
	samples: number;
	medianMs: number;
	minMs: number;
	maxMs: number;
	medianMutations: number;
	heapDeltaMb: number | null;
}

export interface MeasureOptions {
	samples?: number;
	/** Warmup passes excluded from the result (JIT, layout caches). */
	warmup?: number;
}

export const measureOperation = async (
	root: Node,
	operation: Operation,
	options: MeasureOptions = {},
): Promise<OperationResult> => {
	const sampleCount = options.samples ?? 10;
	const warmupCount = options.warmup ?? 1;
	const counter = observeMutations(root);
	const msSamples: number[] = [];
	const mutationSamples: number[] = [];

	const heapStart = readHeapMb();
	for (let run = 0; run < warmupCount + sampleCount; run++) {
		await operation.prepare?.();
		await waitForPaint();

		counter.reset();
		const start = performance.now();
		await operation.apply();
		await waitForPaint();
		const elapsed = performance.now() - start;
		const mutations = counter.read();

		if (run >= warmupCount) {
			msSamples.push(elapsed);
			mutationSamples.push(mutations);
		}
	}
	const heapEnd = readHeapMb();
	counter.stop();

	return {
		label: operation.label,
		samples: sampleCount,
		medianMs: median(msSamples),
		minMs: Math.min(...msSamples),
		maxMs: Math.max(...msSamples),
		medianMutations: median(mutationSamples),
		heapDeltaMb:
			heapStart !== null && heapEnd !== null ? heapEnd - heapStart : null,
	};
};

export const measureSuite = async (
	root: Node,
	operations: ReadonlyArray<Operation>,
	options?: MeasureOptions,
): Promise<OperationResult[]> => {
	const results: OperationResult[] = [];
	for (let index = 0; index < operations.length; index++) {
		results.push(await measureOperation(root, operations[index], options));
	}
	return results;
};

// --- window mode (continuous animation, observed not driven) -------------

export interface WindowResult {
	frames: number;
	durationMs: number;
	framesPerSecond: number;
	medianFrameMs: number;
	mutations: number;
	mutationsPerFrame: number;
	heapDeltaMb: number | null;
}

/**
 * Watches a self-driving animation for a wall-clock window — counts frames and
 * mutations without owning the rAF loop, so it measures the component as-is.
 */
export const measureWindow = async (
	root: Node,
	durationMs: number,
): Promise<WindowResult> => {
	const counter = observeMutations(root);
	const frameTimes: number[] = [];
	const heapStart = readHeapMb();
	const start = performance.now();
	let last = start;

	await new Promise<void>((resolve) => {
		const tick = () => {
			const now = performance.now();
			frameTimes.push(now - last);
			last = now;
			if (now - start >= durationMs) {
				resolve();
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	const duration = performance.now() - start;
	const mutations = counter.read();
	const heapEnd = readHeapMb();
	counter.stop();
	const frames = frameTimes.length;

	return {
		frames,
		durationMs: duration,
		framesPerSecond: (frames / duration) * 1000,
		medianFrameMs: median(frameTimes),
		mutations,
		mutationsPerFrame: mutations / frames,
		heapDeltaMb:
			heapStart !== null && heapEnd !== null ? heapEnd - heapStart : null,
	};
};

// --- baseline + delta ----------------------------------------------------

export interface Baseline<T> {
	capturedAt: string;
	value: T;
}

export const loadBaseline = <T>(storageKey: string): Baseline<T> | null => {
	try {
		const raw = localStorage.getItem(storageKey);
		return raw ? (JSON.parse(raw) as Baseline<T>) : null;
	} catch {
		return null;
	}
};

export const saveBaseline = <T>(storageKey: string, value: T): Baseline<T> => {
	const baseline: Baseline<T> = {
		capturedAt: new Date().toISOString(),
		value,
	};
	try {
		localStorage.setItem(storageKey, JSON.stringify(baseline));
	} catch {
		// localStorage may be unavailable (private mode); non-fatal
	}
	return baseline;
};

export const clearBaseline = (storageKey: string): void => {
	try {
		localStorage.removeItem(storageKey);
	} catch {
		// non-fatal
	}
};

/** Signed percentage delta of current vs baseline, e.g. "+3.4%" / "-12.0%". */
export const formatDelta = (current: number, previous: number): string => {
	if (previous === 0) return current === 0 ? "0%" : "—";
	const delta = ((current - previous) / previous) * 100;
	return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
};
