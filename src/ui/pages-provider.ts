import {
  IconParkProviderCore,
  type IconRecord,
  type IconRenderer,
} from "../core/provider-shared.js";
import {
  MAX_PAGES_ICON_CATALOG_BYTES,
  MAX_COMPRESSED_PAGES_ICON_CATALOG_BYTES,
  parsePagesIconCatalog,
  renderIconTemplate,
  type PagesIconCatalog,
} from "./pages-icon-catalog.js";

export { ICON_PARK_CAPABILITIES, type IconRecord } from "../core/provider-shared.js";

let activeCatalog: PagesIconCatalog | null = null;
let catalogLoad: Promise<void> | null = null;

async function loadCatalog(): Promise<void> {
  const request = (path: string) => fetch(new URL(path, document.baseURI), {
    cache: "force-cache",
    credentials: "omit",
  });

  let source: string | null = null;
  if (typeof DecompressionStream === "function") {
    try {
      const compressedResponse = await request("./assets/icon-catalog.json.gz");
      if (compressedResponse.ok) {
        const compressed = await compressedResponse.arrayBuffer();
        if (compressed.byteLength > MAX_COMPRESSED_PAGES_ICON_CATALOG_BYTES) {
          throw new Error(`The compressed IconPark catalog exceeds ${MAX_COMPRESSED_PAGES_ICON_CATALOG_BYTES} bytes.`);
        }
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
        source = await new Response(stream).text();
      }
    } catch {
      // A static host or older embedded browser may not support the optimized
      // asset. The same byte-checked JSON remains a compatibility fallback.
      source = null;
    }
  }

  if (source === null) {
    const response = await request("./assets/icon-catalog.json");
    if (!response.ok) {
      throw new Error(`The published IconPark catalog could not be loaded (HTTP ${response.status}).`);
    }
    source = await response.text();
  }
  if (new TextEncoder().encode(source).byteLength > MAX_PAGES_ICON_CATALOG_BYTES) {
    throw new Error(`The published IconPark catalog exceeds ${MAX_PAGES_ICON_CATALOG_BYTES} bytes.`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch {
    throw new Error("The published IconPark catalog could not be decoded.");
  }
  activeCatalog = parsePagesIconCatalog(decoded);
}

export async function initializePagesProvider(): Promise<void> {
  if (activeCatalog !== null) return;
  catalogLoad ??= loadCatalog().catch((error: unknown) => {
    catalogLoad = null;
    throw error;
  });
  await catalogLoad;
}

export class IconParkProvider extends IconParkProviderCore {
  constructor() {
    const catalog = activeCatalog;
    if (catalog === null) {
      throw new Error("The published IconPark catalog has not finished loading.");
    }
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
