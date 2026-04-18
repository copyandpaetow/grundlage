import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    base: "/grundlage",
    server: {port: 8001, host: true},
    appType: "mpa",
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                async: resolve(__dirname, "pages/async/index.html"),
                animation: resolve(__dirname, "pages/animation/index.html"),
                animationList: resolve(__dirname, "pages/animation-list/index.html"),
                attributes: resolve(__dirname, "pages/attributes/index.html"),
                list: resolve(__dirname, "pages/list/index.html"),
                tags: resolve(__dirname, "pages/tags/index.html"),
                perf: resolve(__dirname, "pages/perf/index.html"),
                reorderStress: resolve(__dirname, "pages/reorder-stress/index.html"),
            },
        },
    },
    // plugins: [prerenderWebcomponents()],
    // site: "https://copyandpaetow.github.io",
});
