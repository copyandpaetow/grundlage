import { defineConfig } from "tsdown";

export default defineConfig({
	//the worker is loaded by its file path at runtime, so it is an entry of its own
	entry: ["index.ts", "ssr-render.worker.ts"],
	tsconfig: "tsconfig.build.json",
	format: ["esm"],
	platform: "node",
	target: "es2024",
	outDir: "dist",
	dts: true,
	minify: false,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: true,
	},
});
