import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const isMcpApp = process.env["ICON_MCP_APP"] === "1";

export default defineConfig({
  base: "./",
  plugins: [react(), ...(isMcpApp ? [viteSingleFile()] : [])],
  build: {
    outDir: isMcpApp ? "dist/mcp-app" : "dist/web",
    emptyOutDir: true,
    sourcemap: !isMcpApp,
    target: "es2022",
  },
});
