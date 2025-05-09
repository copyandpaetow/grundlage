import { defineConfig } from "vite";
import { prerenderWebcomponents } from "../prerender-plugin";

export default defineConfig({
	root: ".",
	base: "/grundlage",
	server: { port: 8001, host: true },
	plugins: [prerenderWebcomponents()],
	// site: "https://copyandpaetow.github.io",
});
