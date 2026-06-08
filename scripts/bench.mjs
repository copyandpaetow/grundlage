#!/usr/bin/env node
/*
benchmark launcher that pins the run to a single CPU core on Linux.

why: on a virtualized/throttled host (CI, the linuxkit dev container) the dominant
benchmark noise is the V8 process migrating between cores — each migration restarts on a
cold cache and the host scales per-core frequency independently, so absolute hz drifts
15–25% run-to-run with no code change. Holding the forked process on one core cut the
identical-code A/B noise floor to ~4% here (measured). nice -n 10 yields to the scheduler
so a busy neighbor preempts us cleanly instead of fighting mid-sample.

taskset/nice are Linux-only; macOS has no equivalent affinity CLI, so on every other
platform (the canonical baseline is captured on the author's Mac) this is a transparent
pass-through. Pin core defaults to the highest index (core 0 carries most IRQ traffic);
override with BENCH_CPU.
*/
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";

const command = process.argv.slice(2);
if (command.length === 0) {
	console.error("usage: node scripts/bench.mjs <command> [args...]");
	process.exit(2);
}

//resolve a bare `vitest` to the workspace binary so the wrapper doesn't depend on npx
if (command[0] === "vitest") {
	const local = new URL("../node_modules/.bin/vitest", import.meta.url).pathname;
	if (existsSync(local)) command[0] = local;
}

const pinCore = process.env.BENCH_CPU ?? String(availableParallelism() - 1);
const canPin = process.platform === "linux" && existsSync("/usr/bin/taskset");

const [bin, ...args] = canPin
	? ["taskset", "-c", pinCore, "nice", "-n", "10", ...command]
	: command;

if (canPin) console.error(`[bench] pinned to CPU ${pinCore}`);

spawn(bin, args, { stdio: "inherit" }).on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 1);
});
