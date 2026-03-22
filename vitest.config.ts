import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
	test: {
		projects: [
			{
				root: "./lib",
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: [...configDefaults.exclude, "src/**/*.browser.test.ts"],
					environment: "node",
				},
			},
			{
				root: "./lib",
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
