import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { browserProviderAlias } from "./vite.browser-runtime.js";

const projectRoot = import.meta.dirname;
const figmaRoot = resolve(projectRoot, "figma-plugin");
const figmaOutDir = resolve(figmaRoot, "dist");
const buildTarget = process.env["FIGMA_BUILD_TARGET"] ?? "ui";

export default defineConfig(buildTarget === "main"
  ? {
    build: {
      outDir: figmaOutDir,
      emptyOutDir: false,
      target: "es2020",
      minify: "esbuild",
      lib: {
        entry: resolve(projectRoot, "src/figma/main.ts"),
        formats: ["iife"],
        name: "ArmorialFigmaPlugin",
        fileName: () => "main.js",
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  }
  : {
    root: figmaRoot,
    base: "./",
    plugins: [browserProviderAlias(projectRoot), react(), viteSingleFile()],
    build: {
      outDir: figmaOutDir,
      emptyOutDir: true,
      target: "es2022",
      minify: "esbuild",
      chunkSizeWarningLimit: 12_000,
      rollupOptions: {
        input: resolve(figmaRoot, "ui.html"),
      },
    },
    server: {
      fs: { allow: [projectRoot] },
    },
  });
