import { IconKernelError } from "../core/errors.js";
import {
  IconParkProviderCore,
  type IconRecord,
  type IconRenderer,
} from "../core/provider-shared.js";
import {
  MAX_PAGES_ICON_CATALOG_BYTES,
  PAGES_ICON_CATALOG_VERSION,
  renderIconTemplate,
  type PagesIconCatalog,
} from "./pages-icon-catalog.js";

export { ICON_PARK_CAPABILITIES, type IconRecord } from "../core/provider-shared.js";

let activeCatalog: PagesIconCatalog | null = null;
let catalogLoad: Promise<void> | null = null;

function invalidCatalog(message: string): IconKernelError {
  return new IconKernelError({ code: "ICON_RENDER_FAILED", message });
}

function parseCatalog(value: unknown): PagesIconCatalog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidCatalog("The published IconPark catalog has an invalid envelope.");
  }
  const candidate = value as { version?: unknown; metadata?: unknown; templates?: unknown };
  if (candidate.version !== PAGES_ICON_CATALOG_VERSION) {
    throw invalidCatalog("The published IconPark catalog version is not supported.");
  }
  if (typeof candidate.templates !== "object" || candidate.templates === null || Array.isArray(candidate.templates)) {
    throw invalidCatalog("The published IconPark catalog has no renderer templates.");
  }
  const templates = Object.create(null) as Record<string, string>;
  for (const [name, template] of Object.entries(candidate.templates)) {
    if (typeof template !== "string") {
      throw invalidCatalog(`The published IconPark template "${name}" is invalid.`);
    }
    templates[name] = template;
  }
  return {
    version: PAGES_ICON_CATALOG_VERSION,
    metadata: candidate.metadata,
    templates,
  };
}

async function loadCatalog(): Promise<void> {
  const response = await fetch(new URL("./assets/icon-catalog.json", document.baseURI), {
    cache: "force-cache",
    credentials: "omit",
  });
  if (!response.ok) {
    throw invalidCatalog(`The published IconPark catalog could not be loaded (HTTP ${response.status}).`);
  }
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > MAX_PAGES_ICON_CATALOG_BYTES) {
    throw invalidCatalog(`The published IconPark catalog exceeds ${MAX_PAGES_ICON_CATALOG_BYTES} bytes.`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch {
    throw invalidCatalog("The published IconPark catalog could not be decoded.");
  }
  activeCatalog = parseCatalog(decoded);
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
      throw invalidCatalog("The published IconPark catalog has not finished loading.");
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
