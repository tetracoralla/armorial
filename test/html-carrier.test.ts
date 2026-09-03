import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHtmlCarrierStructure } from "../src/adapters/html-carrier.js";
import { IconKernelError } from "../src/core/errors.js";

function assertInvalidCarrier(source: string, message: RegExp): void {
  assert.throws(
    () => parseHtmlCarrierStructure(source),
    (error: unknown) => {
      assert.ok(error instanceof IconKernelError);
      assert.equal(error.error.code, "INVALID_INPUT");
      assert.equal(error.error.field, "inline-into");
      assert.match(error.error.message, message);
      return true;
    },
  );
}

test("HTML carrier parser streams long body text without retaining it in the structural tree", () => {
  const source = `<!doctype html><html><body><main>${"x".repeat(512 * 1024)}</main></body></html>`;
  const structure = parseHtmlCarrierStructure(source);
  assert.equal(structure.bodyContentStart, source.indexOf("<body>") + "<body>".length);
  assert.equal(structure.bodyContentEnd, source.indexOf("</body>"));
});

test("HTML carrier parser closes oversized lexical and structural inputs", () => {
  assertInvalidCarrier(
    `<!doctype html><html><body><!--${"x".repeat(65 * 1024)}--></body></html>`,
    /tokens must not exceed/,
  );
  assertInvalidCarrier(
    `<!doctype html><html><body><main data-large="${"x".repeat(65 * 1024)}"></main></body></html>`,
    /tokens must not exceed/,
  );
  assertInvalidCarrier(
    `<!doctype html><html><body>${"<div>".repeat(300)}${"</div>".repeat(300)}</body></html>`,
    /open elements/,
  );
  assertInvalidCarrier(
    `<!doctype html><html><body>${"<span></span>".repeat(50_001)}</body></html>`,
    /structural nodes/,
  );
});
