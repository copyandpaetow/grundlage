import { defineConfig } from "vite";
import { prerenderWebcomponents } from "../../index";

//`virtual:greeting` only resolves through this plugin, so a component importing it loads
//exactly when the loader server ran this config — and not otherwise
const greetingPlugin = () => ({
	name: "fixture-virtual-greeting",
	resolveId(id: string) {
		return id === "virtual:greeting" ? "\0virtual:greeting" : null;
	},
	load(id: string) {
		return id === "\0virtual:greeting"
			? `export const greeting = "greetings from a project plugin";`
			: null;
	},
});

//the plugin appears in its own loader server's config: it has to stay inert there
export default defineConfig({
	plugins: [greetingPlugin(), prerenderWebcomponents()],
});
