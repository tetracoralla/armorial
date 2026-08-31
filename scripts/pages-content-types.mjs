import { extname } from "node:path";

const localTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gz", "application/gzip"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

const deployedTypes = new Map([
  [".css", /^(?:text\/css)(?:;|$)/i],
  [".gz", /^(?:application\/(?:gzip|x-gzip|octet-stream))(?:;|$)/i],
  [".html", /^(?:text\/html)(?:;|$)/i],
  [".js", /^(?:(?:text|application)\/javascript)(?:;|$)/i],
  [".json", /^(?:application\/json)(?:;|$)/i],
  [".md", /^(?:text\/(?:markdown|plain))(?:;|$)/i],
  [".svg", /^(?:image\/svg\+xml)(?:;|$)/i],
  [".txt", /^(?:text\/plain)(?:;|$)/i],
  [".xml", /^(?:(?:application|text)\/xml)(?:;|$)/i],
]);

export function localContentType(path) {
  return localTypes.get(extname(path)) ?? "application/octet-stream";
}

export function hasExpectedDeployedContentType(path, value) {
  const expected = deployedTypes.get(extname(path));
  return expected !== undefined && expected.test(value ?? "");
}
