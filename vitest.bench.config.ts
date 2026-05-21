import { defineConfig } from "vitest/config";

/*
bench mode runs under a single forked process so all bench files share one V8 instance with no parallel-worker CPU contention
=> the npm scripts (test:bench / bench:baseline / bench:compare) point at this config; regular `vitest` / `vitest run` still uses the default pool from vitest.config.ts

vitest v4 removed tinypool and flattened pool config: poolOptions is gone, singleThread/singleFork are now maxWorkers: 1 + isolate: false
=> isolate: false skips module-graph reload between bench files which cuts a few seconds of overhead per file; bench files don't share mutable module state we care about
*/
export default defineConfig({
	test: {
		pool: "forks",
		maxWorkers: 1,
		isolate: false,
		//bench files live alongside the dom-tagged tests; happy-dom is the shared environment
		include: ["lib/tests/performance/**/*.bench.ts"],
		environment: "happy-dom",
	},
});
