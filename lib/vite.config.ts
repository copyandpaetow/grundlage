import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "grundlage",
      fileName: "grundlage",
    },
    target: "es2022",
  },
});
