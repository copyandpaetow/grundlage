import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { prerenderWebcomponents } from "../prerender-plugin";

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
				list: resolve(__dirname, "pages/list/index.html"),
				cubes: resolve(__dirname, "pages/cubes/index.html"),
			},
		},
	},
	// plugins: [prerenderWebcomponents()],
	// site: "https://copyandpaetow.github.io",
});
