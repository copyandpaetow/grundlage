import { defineConfig } from "vitest/config";

/*
bench mode runs under a single forked process so each bench file gets a fresh V8 instance, no shared JIT state, and no parallel-worker CPU contention
=> the npm scripts (test:bench / bench:baseline / bench:compare) point at this config; regular `vitest` / `vitest run` still uses the default pool from vitest.config.ts
*/
export default defineConfig({
	test: {
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
		//bench files live alongside the dom-tagged tests; happy-dom is the shared environment
		include: ["lib/tests/performance/**/*.bench.ts"],
		environment: "happy-dom",
	},
});
