import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import {
  browserProviderAlias,
  browserStandaloneRuntimeAlias,
  embeddedWorkbenchMetadataBoundary,
  pagesIconCatalogAsset,
  pagesProviderAlias,
  pagesSourceCommitAsset,
} from "./vite.browser-runtime.js";

const isMcpApp = process.env["ICON_MCP_APP"] === "1";
const isPages = process.env["ARMORIAL_PAGES"] === "1";
const isLicenseScan = process.env["ARMORIAL_LICENSE_SCAN"] === "1";
const projectRoot = import.meta.dirname;

export default defineConfig({
  base: "./",
  // Agent-discovery documents belong to the standalone/public web carrier,
  // never the single-file MCP App resource.
  publicDir: isMcpApp ? false : "public",
  plugins: [
    ...(isPages ? [
      pagesIconCatalogAsset(),
      pagesSourceCommitAsset(projectRoot),
      pagesProviderAlias(projectRoot),
      browserStandaloneRuntimeAlias(projectRoot),
    ] : []),
    ...(isMcpApp ? [embeddedWorkbenchMetadataBoundary()] : []),
    react(),
    ...(isMcpApp && !isLicenseScan ? [viteSingleFile()] : []),
  ],
  build: {
    // License-scan builds exist only to emit module manifests for
    // THIRD_PARTY_NOTICES generation; they never touch publishable output.
    outDir: isLicenseScan
      ? (isMcpApp ? ".license-build/mcp-app" : ".license-build/web")
      : isMcpApp ? "dist/mcp-app" : isPages ? ".pages-dist" : "dist/web",
    emptyOutDir: true,
    ...(isLicenseScan ? { license: { fileName: ".vite/licenses.json" } } : {}),
    sourcemap: !isMcpApp && !isPages,
    target: "es2022",
    chunkSizeWarningLimit: isPages ? 4_000 : 500,
  },
});
