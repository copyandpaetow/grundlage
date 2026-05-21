/*
shared per-bench options so every measurement uses the same warmup + sampling budget

defaults of ~500ms / minimal warmup leave V8 in a half-JITted state for these hot paths
=> we extend warmup so TurboFan has time to settle the polymorphic dispatch in updateByType / bindingToString, and we extend total time so the relative-margin-of-error column tightens to a usable range
this is the moderate budget — full-fat 2000/500/100 buys another half-percent of RME but pushes the full suite past 10 minutes; tinybench keeps sampling past `time` until variance settles, so the wall-clock cost of larger windows is super-linear
*/

import {
	bench as baseBench,
	type BenchOptions,
	type BenchFunction,
} from "vitest";

export const stableBenchOptions: BenchOptions = {
	time: 1500,
	warmupTime: 300,
	warmupIterations: 75,
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
