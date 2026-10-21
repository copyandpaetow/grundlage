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

const isPublicEntry = ({ specifier }: RelativeImport): boolean =>
	PUBLIC_ENTRY.test(specifier);

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
		replacement: join(
			libraryDirectory,
			".test-bundle",
			projectName,
			"index.mjs",
		),
	},
];

export default defineConfig({
	test: {
		projects: [
			{
				root: "./lib",
				test: {
					name: "unit",
					include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
					exclude: [
						...configDefaults.exclude,
						"**/*.browser.test.ts",
						"**/*.dom.test.ts",
					],
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
					include: ["src/**/*.dom.test.ts", "tests/**/*.dom.test.ts"],
					environment: "happy-dom",
				},
			},
			{
				root: "./lib",
				test: {
					name: "browser-as-dom",
					include: ["src/**/*.browser.test.ts", "tests/**/*.browser.test.ts"],
					environment: "happy-dom",
					benchmark: {
						include: [],
					},
				},
			},
			{
				root: "./lib",
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.ts", "tests/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
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
					include: publicEntryTests("{src,tests}/**/*.dom.test.ts"),
					environment: "happy-dom",
					globalSetup: "tests/build-test-bundle.ts",
				},
			},
			{
				root: "./lib",
				resolve: { alias: testBundleAliasOf("bundle-browser") },
				test: {
					name: "bundle-browser",
					include: publicEntryTests("{src,tests}/**/*.browser.test.ts"),
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
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
		],
	},
});
