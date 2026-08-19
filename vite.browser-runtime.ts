import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";
import {
  createIconTemplate,
  PAGES_ICON_CATALOG_VERSION,
  type IconTemplateSourceRenderer,
} from "./src/ui/pages-icon-catalog.js";

const require = createRequire(import.meta.url);

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

export function pagesProviderAlias(projectRoot: string): Plugin {
  return {
    name: "armorial-pages-provider",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./provider.js" && importer?.endsWith("/src/core/kernel.ts")) {
        return resolve(projectRoot, "src/ui/pages-provider.ts");
      }
      return null;
    },
  };
}

export function pagesIconCatalogAsset(): Plugin {
  return {
    name: "armorial-pages-icon-catalog-asset",
    buildStart() {
      const metadata: unknown = require("@icon-park/svg/icons.json");
      if (!Array.isArray(metadata)) throw new Error("The pinned IconPark metadata is not an array.");
      const packageRoot = dirname(require.resolve("@icon-park/svg/package.json"));
      const templates: Record<string, string> = {};
      for (const item of metadata) {
        if (typeof item !== "object" || item === null || typeof (item as { name?: unknown }).name !== "string") {
          throw new Error("The pinned IconPark metadata contains an invalid icon name.");
        }
        const name = (item as { name: string }).name;
        const moduleSlug = name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
        const loaded: unknown = require(join(packageRoot, "lib", "icons", `${moduleSlug}.js`));
        const renderer = (loaded as { default?: unknown }).default;
        if (typeof renderer !== "function") throw new Error(`IconPark renderer "${name}" is missing.`);
        templates[name] = createIconTemplate(renderer as IconTemplateSourceRenderer);
      }
      this.emitFile({
        type: "asset",
        fileName: "assets/icon-catalog.json",
        source: JSON.stringify({ version: PAGES_ICON_CATALOG_VERSION, metadata, templates }),
      });
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
