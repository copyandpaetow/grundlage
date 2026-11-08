import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const libraryDirectory = fileURLToPath(new URL("./lib", import.meta.url));
const PUBLIC_ENTRY = /^(\.\.\/)+(src\/)?index$/;
const TYPES_MODULE = /^(\.\.\/)+(src\/)?types$/;
const TYPE_ONLY_SPECIFIERS = /^\{(\s*type \w+,?)+\s*\}$/;

interface RelativeImport {
	clause: string;
	specifier: string;
}

const isPublicEntry = ({ specifier }: RelativeImport): boolean => PUBLIC_ENTRY.test(specifier);

//a namespace import is an enum module, plain constants like a type, so the bundle cannot disagree
const isNotLibraryCode = ({ clause, specifier }: RelativeImport): boolean =>
	TYPES_MODULE.test(specifier) ||
	clause.startsWith("type ") ||
	clause.startsWith("* as ") ||
	TYPE_ONLY_SPECIFIERS.test(clause);

//a test that reaches the library only through its public entry runs a second time on the minified
//bundle, the one place a shortened property name can break
const publicEntryTests = (pattern: string): Array<string> =>
	globSync(pattern, {
		cwd: libraryDirectory,
		exclude: (path) => path.includes("__screenshots__"),
	}).filter((file) => {
		const imports = Array.from(
			readFileSync(join(libraryDirectory, file), "utf8").matchAll(
				/import\s+([^;]*?)\s+from\s+"(\.[^"]*)"/g,
			),
			([, clause, specifier]): RelativeImport => ({ clause, specifier }),
		);
		return (
			imports.some(isPublicEntry) &&
			imports.every((entry) => isPublicEntry(entry) || isNotLibraryCode(entry))
		);
	});

//lib/tests/build-test-bundle.ts builds each bundle project's own bundle there before it runs
const testBundleAliasOf = (projectName: string) => [
	{
		find: PUBLIC_ENTRY,
		replacement: join(libraryDirectory, ".test-bundle", projectName, "index.mjs"),
	},
];

const ENGINES = ["chromium", "firefox", "webkit"] as const;
type Engine = (typeof ENGINES)[number];
const isEngine = (name: string): name is Engine => ENGINES.some((engine) => engine === name);

//npm run test:engines sets BROWSERS to all three; Chromium alone otherwise. A list per project,
//since vitest writes each instance's name into it
const libraryBrowserInstances = () =>
	(process.env.BROWSERS ?? "chromium").split(",").map((name) => {
		if (!isEngine(name)) {
			throw new Error(`BROWSERS expects chromium, firefox or webkit, not "${name}".`);
		}
		return { browser: name };
	});

//npm run fuzz sets these; without them every fuzzer runs its own fixed seeds
const fuzzSettings = {
	fuzzScale: Number(process.env.FUZZ_SCALE ?? 1),
	fuzzFirstSeed:
		process.env.FUZZ_FIRST_SEED === undefined ? null : Number(process.env.FUZZ_FIRST_SEED),
};

//one happy-dom per worker instead of one per file takes a third off the happy-dom projects. The files
//in a worker share modules and the custom element registry, so no test may rely on fresh ones
const isolateHappyDomFiles = false;

export default defineConfig({
	test: {
		projects: [
			{
				root: "./lib",
				test: {
					name: "unit",
					include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
					exclude: [...configDefaults.exclude, "**/*.browser.test.ts", "**/*.dom.test.ts"],
					environment: "node",
					benchmark: {
						include: [],
					},
				},
			},
			{
				root: "./lib",
				test: {
					name: "dom",
					provide: fuzzSettings,
					include: ["src/**/*.dom.test.ts", "tests/**/*.dom.test.ts"],
					environment: "happy-dom",
					isolate: isolateHappyDomFiles,
				},
			},
			{
				root: "./lib",
				test: {
					name: "browser-as-dom",
					provide: fuzzSettings,
					include: ["src/**/*.browser.test.ts", "tests/**/*.browser.test.ts"],
					environment: "happy-dom",
					isolate: isolateHappyDomFiles,
					benchmark: {
						include: [],
					},
				},
			},
			{
				root: "./lib",
				test: {
					name: "browser",
					provide: fuzzSettings,
					include: ["src/**/*.browser.test.ts", "tests/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						provider: playwright(),
						instances: libraryBrowserInstances(),
					},
					benchmark: {
						include: [],
					},
				},
			},
			{
				root: "./lib",
				resolve: { alias: testBundleAliasOf("bundle-dom") },
				test: {
					name: "bundle-dom",
					provide: fuzzSettings,
					include: publicEntryTests("{src,tests}/**/*.dom.test.ts"),
					environment: "happy-dom",
					isolate: isolateHappyDomFiles,
					globalSetup: "tests/build-test-bundle.ts",
				},
			},
			{
				root: "./lib",
				resolve: { alias: testBundleAliasOf("bundle-browser") },
				test: {
					name: "bundle-browser",
					provide: fuzzSettings,
					include: publicEntryTests("{src,tests}/**/*.browser.test.ts"),
					browser: {
						enabled: true,
						provider: playwright(),
						instances: libraryBrowserInstances(),
					},
					globalSetup: "tests/build-test-bundle.ts",
					benchmark: {
						include: [],
					},
				},
			},
			{
				root: "./website",
				test: {
					name: "cubes",
					include: ["pages/cubes/**/*.dom.test.ts"],
					environment: "happy-dom",
				},
			},
			{
				root: "./website",
				test: {
					//happy-dom upgrades custom elements inside template.content, so a component
					//rendered from another component's template never shows its own content there
					name: "cubes-browser",
					include: ["pages/cubes/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
			{
				root: "./prerender-plugin",
				test: {
					name: "prerender-plugin",
					include: ["**/*.test.ts"],
					environment: "node",
					benchmark: {
						include: [],
					},
				},
			},
			{
				root: "./lint",
				test: {
					name: "lint",
					include: ["*.test.ts"],
					environment: "node",
				},
			},
		],
	},
});
