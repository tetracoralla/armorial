import { z } from "zod";
import { IconIdSchema, RenderStyleSchema, type RenderStyle } from "../core/contracts.js";

const IconLinkSchema = z.strictObject({
  icon: IconIdSchema.transform((id) => id.startsWith("icon-park:") ? id : `icon-park:${id}`),
  render: RenderStyleSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SharedIcon = z.infer<typeof IconLinkSchema>;
const MAX_LINK_FRAGMENT = 2048;

// The fragment stays in the browser; it contains no project path or policy name.
export function readIconLink(hash: string): SharedIcon | null {
  if (!hash.startsWith("#icon=")) return null;
  if (hash.length > MAX_LINK_FRAGMENT) throw new Error("Invalid icon link.");
  const params = new URLSearchParams(hash.slice(1));
  if ([...params.keys()].length !== 3 || [...params.keys()].some((key) => !["icon", "render", "sha256"].includes(key))) {
    throw new Error("Invalid icon link.");
  }
  return IconLinkSchema.parse({
    icon: params.get("icon"), render: JSON.parse(params.get("render") ?? "null"), sha256: params.get("sha256"),
  });
}

export function createIconLink(baseUrl: string, icon: string, render: RenderStyle, sha256: string): string {
  const value = IconLinkSchema.parse({ icon, render, sha256 });
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Open the web workbench to share an icon link.");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = new URLSearchParams({ icon: value.icon, render: JSON.stringify(value.render), sha256: value.sha256 }).toString();
  if (url.hash.length > MAX_LINK_FRAGMENT) throw new Error("Icon link is too large.");
  return url.href;
}
