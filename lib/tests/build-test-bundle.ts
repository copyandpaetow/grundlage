import { join } from "node:path";
import { build } from "tsdown";
import type { TestProject } from "vitest/node";
import { productionOptions } from "../tsdown.config";

//the shipped minifier and property names, with the development flag on so the warnings the tests
//expect are there. Each bundle project builds its own, since projects set up side by side
export default async (project: TestProject): Promise<void> => {
	await build({
		...productionOptions,
		config: false,
		cwd: project.config.root,
		//vitest.config.ts points the public entry of this project's tests here
		outDir: join(project.config.root, ".test-bundle", project.name),
		dts: false,
		sourcemap: false,
		clean: true,
		logLevel: "warn",
		define: { GRUNDLAGE_IS_DEVELOPMENT_BUILD: "true" },
	});
};
