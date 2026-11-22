import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as buildPackage } from "tsdown";
import { build as buildSite, type Rolldown } from "vite";
import { afterAll, expect, test } from "vitest";

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
//inside the package, so the bundle's bare imports (vite, happy-dom) resolve the way they do once
//installed; dist stays untouched, since this build skips the declarations
const packageDirectory = join(pluginDirectory, ".package-test");
const siteRoot = join(pluginDirectory, "__fixtures__/built-package");

afterAll(() => rm(packageDirectory, { recursive: true, force: true }));

test("the built package prerenders a page in a vite build", { timeout: 30_000 }, async () => {
	await buildPackage({
		config: join(pluginDirectory, "tsdown.config.ts"),
		cwd: pluginDirectory,
		outDir: packageDirectory,
		dts: false,
		logLevel: "silent",
	});
	const { prerenderWebComponents } = (await import(
		pathToFileURL(join(packageDirectory, "index.mjs")).href
	)) as typeof import("./index");

	const result = (await buildSite({
		root: siteRoot,
		configFile: false,
		logLevel: "silent",
		plugins: [prerenderWebComponents()],
		build: { write: false, outDir: join(packageDirectory, "site") },
	})) as Rolldown.RolldownOutput;
	const page = result.output.find((file) => file.fileName === "index.html");

	expect(page?.type === "asset" && page.source).toContain("simple-first");
});
