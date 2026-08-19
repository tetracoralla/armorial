import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POLICY } from "../src/core/contracts.js";
import { IconKernelError } from "../src/core/errors.js";
import { finalizeSvg, sha256Hex, utf8ByteLength } from "../src/core/svg.js";

const style = DEFAULT_POLICY.defaults;

test("sanitizer rejects scripts, handlers, external references, imports, and SMIL payloads", () => {
  const payloads = [
    '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1 1"><rect onload="alert(1)"/></svg>',
    '<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg viewBox="0 0 1 1"><a href="https://evil.example/x"><rect/></a></svg>',
    '<svg viewBox="0 0 1 1"><rect fill="url(https://evil.example/x)"/></svg>',
    '<svg viewBox="0 0 1 1"><style>@import "https://evil.example/x.css";</style></svg>',
    '<svg viewBox="0 0 1 1"><set attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg viewBox="0 0 1 1"><animate attributeName="x" to="10"/></svg>',
    '<svg viewBox="0 0 1 1"><animateTransform attributeName="transform"/></svg>',
    '<svg viewBox="0 0 1 1"><image href="https://evil.example/x.png"/></svg>',
    '<svg viewBox="0 0 1 1"><image src="https://evil.example/x.png"/></svg>',
    '<svg viewBox="0 0 1 1"><iframe src="https://evil.example/x"></iframe></svg>',
    '<svg viewBox="0 0 1 1"><object data="x"/></svg>',
    '<svg viewBox="0 0 1 1"><embed src="x"/></svg>',
    '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
    '<svg viewBox="0 0 1 1"><use xlink:href="//evil.example/x"/></svg>',
  ];
  for (const payload of payloads) {
    assert.throws(() => finalizeSvg("test", payload, style), IconKernelError, payload);
  }
});

test("sanitizer keeps internal-reference SVG renderable, stable, and renames internal ids", () => {
  const payload = '<svg width="1" height="1" viewBox="0 0 48 48">'
    + '<linearGradient id="icon-abc123"><stop/></linearGradient>'
    + '<rect fill="url(#icon-abc123)"/></svg>';
  const first = finalizeSvg("test", payload, style);
  const second = finalizeSvg("test", payload, style);
  assert.equal(first.viewBox, "0 0 48 48");
  assert.match(first.svg, /url\(#icon-svg-select-test-[a-f0-9]{12}\)/);
  assert.equal(first.sha256, second.sha256);
});

test("browser-safe UTF-8 and SHA-256 helpers preserve Node carrier semantics", () => {
  const value = "Armorial / 图标 / 🛡️";
  assert.equal(utf8ByteLength(value), Buffer.byteLength(value, "utf8"));
  assert.equal(
    sha256Hex(value),
    "185fa771305a4976e8c5958c21e109dfcc1aa5999c6cd3a40ffc8fbf8dfa602c",
  );
});
