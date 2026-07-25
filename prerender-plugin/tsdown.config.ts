import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["index.ts"],
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
