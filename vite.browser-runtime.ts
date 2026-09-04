import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";
import {
  createIconTemplate,
  PAGES_ICON_CATALOG_VERSION,
  type IconTemplateSourceRenderer,
} from "./src/ui/pages-icon-catalog.js";

const require = createRequire(import.meta.url);
const FIGMA_CATALOG_MODULE_ID = "virtual:armorial-figma-icon-catalog";
const RESOLVED_FIGMA_CATALOG_MODULE_ID = `\0${FIGMA_CATALOG_MODULE_ID}`;

function createSerializedIconCatalog(): string {
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
  return JSON.stringify({ version: PAGES_ICON_CATALOG_VERSION, metadata, templates });
}

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
      const source = createSerializedIconCatalog();
      this.emitFile({
        type: "asset",
        fileName: "assets/icon-catalog.json",
        source,
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/icon-catalog.json.gz",
        source: gzipSync(source, { level: 9 }),
      });
    },
  };
}

export function figmaIconCatalogModule(): Plugin {
  return {
    name: "armorial-figma-icon-catalog-module",
    enforce: "pre",
    resolveId(source) {
      return source === FIGMA_CATALOG_MODULE_ID ? RESOLVED_FIGMA_CATALOG_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_FIGMA_CATALOG_MODULE_ID) return null;
      const compressed = gzipSync(createSerializedIconCatalog(), { level: 9 }).toString("base64");
      return `export default ${JSON.stringify(compressed)};`;
    },
  };
}

export function pagesSourceCommitAsset(projectRoot: string): Plugin {
  return {
    name: "armorial-pages-source-commit-asset",
    buildStart() {
      const revision = (
        process.env["ARMORIAL_SOURCE_REVISION"]
        ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" })
      ).trim().toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(revision)) {
        throw new Error("ARMORIAL_SOURCE_REVISION must be one complete 40-character Git commit.");
      }
      this.emitFile({
        type: "asset",
        fileName: "source-commit.txt",
        source: `${revision}\n`,
      });
    },
  };
}

export function embeddedWorkbenchMetadataBoundary(): Plugin {
  const publicOnlyMarkers = [
    'name="robots"',
    'rel="canonical"',
    'rel="help"',
    'rel="describedby"',
    "<noscript>",
  ];
  return {
    name: "armorial-embedded-workbench-metadata-boundary",
    transformIndexHtml(html) {
      return html
        .split("\n")
        .filter((line) => !publicOnlyMarkers.some((marker) => line.includes(marker)))
        .join("\n");
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
