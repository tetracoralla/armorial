import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { IconKernelError } from "./errors.js";
import {
  IconParkProviderCore,
  rendererModuleSlug,
  type IconRecord,
} from "./provider-shared.js";

export { ICON_PARK_CAPABILITIES, type IconRecord } from "./provider-shared.js";

const require = createRequire(import.meta.url);

export class IconParkProvider extends IconParkProviderCore {
  constructor() {
    const rawMetadata: unknown = require("@icon-park/svg/icons.json");
    const rendererModulesDir = join(
      dirname(require.resolve("@icon-park/svg/package.json")),
      "lib",
      "icons",
    );
    let rendererFiles: ReadonlySet<string>;
    try {
      rendererFiles = new Set(readdirSync(rendererModulesDir).filter((fileName) => fileName.endsWith(".js")));
    } catch {
      throw new IconKernelError({
        code: "ICON_RENDER_FAILED",
        message: "The pinned IconPark package does not expose its per-icon renderer modules.",
      });
    }
    super(rawMetadata, {
      hasRenderer: (record: IconRecord) => rendererFiles.has(`${rendererModuleSlug(record.name)}.js`),
      loadRenderer: (record: IconRecord) => {
        const module: unknown = require(join(rendererModulesDir, `${rendererModuleSlug(record.name)}.js`));
        return (module as { default?: unknown }).default;
      },
    });
  }
}
