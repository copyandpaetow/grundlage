import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
//the source, not the package entry: the site's dev loop must not need the plugin built first
import { prerenderWebcomponents } from "../prerender-plugin/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	base: "/grundlage",
	server: { port: 8001, host: true },
	appType: "mpa",
	build: {
		rollupOptions: {
			input: {
				main: resolve(__dirname, "index.html"),
				async: resolve(__dirname, "pages/async/index.html"),
				animation: resolve(__dirname, "pages/animation/index.html"),
				animationList: resolve(__dirname, "pages/animation-list/index.html"),
				attributes: resolve(__dirname, "pages/attributes/index.html"),
				forms: resolve(__dirname, "pages/forms/index.html"),
				list: resolve(__dirname, "pages/list/index.html"),
				tags: resolve(__dirname, "pages/tags/index.html"),
				perf: resolve(__dirname, "pages/perf/index.html"),
				reorderStress: resolve(__dirname, "pages/reorder-stress/index.html"),
				mutationStress: resolve(__dirname, "pages/mutation-stress/index.html"),
				nested: resolve(__dirname, "pages/nesting/index.html"),
				krausest: resolve(__dirname, "pages/krausest/index.html"),
				ssrVsCsr: resolve(__dirname, "pages/ssr-vs-csr/index.html"),
				cubes: resolve(__dirname, "pages/cubes/index.html"),
				parserBench: resolve(__dirname, "pages/parser-bench/index.html"),
				renderBench: resolve(__dirname, "pages/render-bench/index.html"),
			},
		},
	},
	plugins: [prerenderWebcomponents({ include: ["src/components/**/*.ts"] })],
});
