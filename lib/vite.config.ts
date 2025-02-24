import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "baustein",
      fileName: "baustein",
    },
    target: "es2022",
  },
});
