import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import {
  browserProviderAlias,
  browserStandaloneRuntimeAlias,
  pagesIconCatalogAsset,
  pagesProviderAlias,
} from "./vite.browser-runtime.js";

const isMcpApp = process.env["ICON_MCP_APP"] === "1";
const isPages = process.env["ARMORIAL_PAGES"] === "1";
const projectRoot = import.meta.dirname;

export default defineConfig({
  base: "./",
  plugins: [
    ...(isPages ? [
      pagesIconCatalogAsset(),
      pagesProviderAlias(projectRoot),
      browserStandaloneRuntimeAlias(projectRoot),
    ] : []),
    react(),
    ...(isMcpApp ? [viteSingleFile()] : []),
  ],
  build: {
    outDir: isMcpApp ? "dist/mcp-app" : isPages ? ".pages-dist" : "dist/web",
    emptyOutDir: true,
    sourcemap: !isMcpApp && !isPages,
    target: "es2022",
    chunkSizeWarningLimit: isPages ? 4_000 : 500,
  },
});
