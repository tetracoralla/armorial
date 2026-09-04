import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";

const isPublishHelper = process.argv.some((argument) => String(argument).includes("publish-helper"));

if (isPublishHelper) {
const target = process.env.ARMORIAL_INLINE_CONFLICT_TARGET;
const contentBase64 = process.env.ARMORIAL_INLINE_CONFLICT_CONTENT_BASE64;
const method = process.env.ARMORIAL_INLINE_CONFLICT_METHOD;

if (!target || !contentBase64 || !["in-place", "replace"].includes(method ?? "")) {
  throw new Error("The inline conflict probe requires a target, base64 content, and in-place or replace method.");
}

const replacement = Buffer.from(contentBase64, "base64");
const originalLstat = fs.promises.lstat.bind(fs.promises);
let injected = false;

fs.promises.lstat = async (path, options) => {
  const result = await originalLstat(path, options);
  if (!injected && String(path).includes(".armorial-publish-") && String(path).endsWith(".tmp")) {
    injected = true;
    if (method === "in-place") {
      const descriptor = fs.openSync(target, "r+");
      try {
        fs.writeSync(descriptor, replacement, 0, replacement.byteLength, 0);
        fs.ftruncateSync(descriptor, replacement.byteLength);
      } finally {
        fs.closeSync(descriptor);
      }
    } else {
      const external = `${target}.external-${randomUUID()}`;
      try {
        fs.writeFileSync(external, replacement, { flag: "wx" });
        fs.renameSync(external, target);
      } finally {
        fs.rmSync(external, { force: true });
      }
    }
  }
  return result;
};
syncBuiltinESMExports();

process.on("exit", () => {
  if (!injected) {
    process.stderr.write("Armorial inline conflict probe did not reach the publication window.\n");
    process.exitCode = 97;
  }
});
}
