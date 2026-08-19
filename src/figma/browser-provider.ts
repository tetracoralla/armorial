import iconMetadata from "@icon-park/svg/icons.json";
import * as iconRenderers from "@icon-park/svg";
import {
  IconParkProviderCore,
  rendererModuleSlug,
  type IconRecord,
} from "../core/provider-shared.js";

export { ICON_PARK_CAPABILITIES, type IconRecord } from "../core/provider-shared.js";

const rendererCatalog = iconRenderers as unknown as Readonly<Record<string, unknown>>;

export class IconParkProvider extends IconParkProviderCore {
  constructor() {
    super(iconMetadata, {
      hasRenderer: (record: IconRecord) => typeof rendererCatalog[rendererModuleSlug(record.name)] === "function",
      loadRenderer: (record: IconRecord) => rendererCatalog[rendererModuleSlug(record.name)],
    });
  }
}
