import { defineConfig } from "tsdown";

const sharedOptions = {
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "es2024",
	sourcemap: true,
	deps: {
		skipNodeModulesBundle: true,
	},
} as const;

export default defineConfig([
	{
		...sharedOptions,
		outDir: "dist",
		dts: true,
		minify: true,
		clean: ["dist/*.mjs", "dist/*.mts", "dist/*.map"],
		define: { GRUNDLAGE_IS_DEVELOPMENT_BUILD: "false" },
	},
	{
		...sharedOptions,
		outDir: "dist/development",
		dts: false,
		minify: false,
		clean: true,
		define: { GRUNDLAGE_IS_DEVELOPMENT_BUILD: "true" },
	},
]);
