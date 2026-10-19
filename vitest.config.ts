import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

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
