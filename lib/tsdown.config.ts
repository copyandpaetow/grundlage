import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type UserConfig } from "tsdown";

//read by name from outside this bundle, and declared by no DOM or ES typing
const NAMES_NOT_TO_MANGLE = [
	//the reactions the browser looks up on a custom element class
	"observedAttributes",
	"formAssociated",
	"disabledFeatures",
	"connectedCallback",
	"disconnectedCallback",
	"adoptedCallback",
	"connectedMoveCallback",
	"attributeChangedCallback",
	"formAssociatedCallback",
	"formDisabledCallback",
	"formResetCallback",
	"formStateRestoreCallback",
	//the public API
	"internals",
	"setProp",
	"props",
	//the prop namespace: a bundled `export * as` becomes a plain object
	"property",
	"attribute",
	"optional",
	"oneOf",
	"unreflected",
	"read",
	"eventName",
	//read by another bundled copy of the library: a template it made, or its load() on our runner
	"__templateStrings",
	"wasMountedOnServer",
	"loadsRecordedOnServer",
	"isHydrationPending",
	//the switch a server renderer sets on globalThis
	"__grundlage_ssr__",
];

//every name the platform's typings mention keeps its spelling too, so no call into the DOM or the
//language is renamed. TypeScript ships the typings beside its compiler for this platform
const readPlatformNames = (): Array<string> => {
	const typingsDirectory = join(
		dirname(
			createRequire(import.meta.url).resolve(
				`@typescript/typescript-${process.platform}-${process.arch}/package.json`,
			),
		),
		"lib",
	);
	return readdirSync(typingsDirectory)
		.filter((file) => file.startsWith("lib.") && file.endsWith(".d.ts"))
		.flatMap(
			(file) =>
				readFileSync(join(typingsDirectory, file), "utf8").match(/[\w$]+/g) ??
				[],
		);
};

const sharedOptions: UserConfig = {
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "es2025",
	sourcemap: true,
	deps: {
		neverBundle: true,
	},
};

//every other property name is the library's own and gets a short one. The bundle projects in
//vitest.config.ts run the public-API tests on a bundle minified the same way. Rolldown mangles
//properties only in a single-chunk build, so the declarations are built in a pass of their own
export const productionOptions: UserConfig = {
	...sharedOptions,
	outDir: "dist",
	dts: false,
	minify: {
		mangleProps: {
			include: /^/,
			reserved: [...new Set([...readPlatformNames(), ...NAMES_NOT_TO_MANGLE])],
		},
	},
	clean: ["dist/index.mjs", "dist/index.mjs.map"],
	define: { GRUNDLAGE_IS_DEVELOPMENT_BUILD: "false" },
};

export default defineConfig([
	productionOptions,
	{
		...sharedOptions,
		outDir: "dist",
		dts: { emitDtsOnly: true },
		minify: false,
		clean: ["dist/*.d.mts", "dist/*.d.mts.map"],
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
