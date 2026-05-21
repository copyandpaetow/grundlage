/*
shared per-bench options so every measurement uses the same warmup + sampling budget

defaults of ~500ms / minimal warmup leave V8 in a half-JITted state for these hot paths
=> we extend warmup so TurboFan has time to settle the polymorphic dispatch in updateByType / bindingToString, and we extend total time so the relative-margin-of-error column tightens to ≤2-3%
the cost is longer bench runs (about 4x), but the numbers become trustworthy enough to act on
*/

import {
	bench as baseBench,
	type BenchOptions,
	type BenchFunction,
} from "vitest";

export const stableBenchOptions: BenchOptions = {
	time: 2000,
	warmupTime: 500,
	warmupIterations: 100,
};

//bench files import this wrapper instead of vitest's bench so every measurement runs under the same warmup/time budget
//=> per-bench overrides still work: anything in the third argument wins over stableBenchOptions
export const bench = (
	name: string,
	fn: BenchFunction,
	options?: BenchOptions,
): void => {
	baseBench(name, fn, { ...stableBenchOptions, ...options });
};
