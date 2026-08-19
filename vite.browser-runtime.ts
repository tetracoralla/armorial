import { resolve } from "node:path";
import type { Plugin } from "vite";

export function browserProviderAlias(projectRoot: string): Plugin {
  return {
    name: "armorial-browser-provider",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./provider.js" && importer?.endsWith("/src/core/kernel.ts")) {
        return resolve(projectRoot, "src/figma/browser-provider.ts");
      }
      return null;
    },
  };
}

export function browserStandaloneRuntimeAlias(projectRoot: string): Plugin {
  return {
    name: "armorial-browser-standalone-runtime",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./standalone-browse.js" && importer?.endsWith("/src/ui/runtime.ts")) {
        return resolve(projectRoot, "src/ui/standalone-browse-browser.ts");
      }
      return null;
    },
  };
}
