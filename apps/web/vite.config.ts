import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page("index"),
        workbench: page("workbench"),
        datenschutz: page("datenschutz"),
        impressum: page("impressum"),
      },
    },
  },
});
