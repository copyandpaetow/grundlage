import { defineConfig } from "astro/config";
import { searchForWorkspaceRoot } from "vite";

export default defineConfig({
	base: "/grundlage",
	server: { port: 8001, host: true },
	vite: {
		server: {
			fs: {
				allow: [searchForWorkspaceRoot(process.cwd())],
			},
		},
	},
	site: "https://copyandpaetow.github.io",
	scopedStyleStrategy: "where",
	devToolbar: {
		enabled: false
	  }
});