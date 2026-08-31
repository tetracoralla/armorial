import compressedCatalogBase64 from "virtual:armorial-figma-icon-catalog";
import {
  IconParkProviderCore,
  type IconRenderer,
  type IconRecord,
} from "../core/provider-shared.js";
import {
  MAX_COMPRESSED_PAGES_ICON_CATALOG_BYTES,
  MAX_PAGES_ICON_CATALOG_BYTES,
  parsePagesIconCatalog,
  renderIconTemplate,
  type PagesIconCatalog,
} from "../ui/pages-icon-catalog.js";

export { ICON_PARK_CAPABILITIES, type IconRecord } from "../core/provider-shared.js";

let activeCatalog: PagesIconCatalog | null = null;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function initializeBrowserProvider(): Promise<void> {
  if (activeCatalog !== null) return;
  const compressed = decodeBase64(compressedCatalogBase64);
  if (compressed.byteLength > MAX_COMPRESSED_PAGES_ICON_CATALOG_BYTES) {
    throw new Error(`The embedded IconPark catalog exceeds ${MAX_COMPRESSED_PAGES_ICON_CATALOG_BYTES} compressed bytes.`);
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const source = await new Response(stream).text();
  if (new TextEncoder().encode(source).byteLength > MAX_PAGES_ICON_CATALOG_BYTES) {
    throw new Error(`The embedded IconPark catalog exceeds ${MAX_PAGES_ICON_CATALOG_BYTES} bytes.`);
  }
  activeCatalog = parsePagesIconCatalog(JSON.parse(source) as unknown);
}

export class IconParkProvider extends IconParkProviderCore {
  constructor() {
    const catalog = activeCatalog;
    if (catalog === null) throw new Error("The embedded IconPark catalog has not finished loading.");
    super(catalog.metadata, {
      hasRenderer: (record: IconRecord) => typeof catalog.templates[record.name] === "string",
      loadRenderer: (record: IconRecord): IconRenderer | undefined => {
        const template = catalog.templates[record.name];
        if (template === undefined) return undefined;
        return (props) => renderIconTemplate(template, props);
      },
    });
  }
}
