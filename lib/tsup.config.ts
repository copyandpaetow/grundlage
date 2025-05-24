import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "es2024",
	outDir: "dist",
	dts: true,
	minify: true,
	sourcemap: true,
	clean: true,
	skipNodeModulesBundle: true,
});
