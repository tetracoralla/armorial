import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const isPublishHelper = process.argv.some((argument) => String(argument).includes("publish-helper"));

if (isPublishHelper) {
const target = process.env.ARMORIAL_INLINE_CANDIDATE_TARGET;
const contentBase64 = process.env.ARMORIAL_INLINE_CANDIDATE_CONTENT_BASE64;
const sourceTarget = process.env.ARMORIAL_INLINE_CANDIDATE_SOURCE_TARGET;

if (!target || (!contentBase64 && !sourceTarget)) {
  throw new Error("The candidate output race probe requires a target plus content or a source hard link.");
}

const competingOutput = contentBase64 === undefined ? undefined : Buffer.from(contentBase64, "base64");
const originalLstat = fs.promises.lstat.bind(fs.promises);
let injected = false;

fs.promises.lstat = async (path, options) => {
  const result = await originalLstat(path, options);
  if (
    !injected
    && String(path).includes(".armorial-publish-")
    && String(path).endsWith(".tmp")
  ) {
    injected = true;
    if (sourceTarget !== undefined) fs.linkSync(sourceTarget, target);
    else fs.writeFileSync(target, competingOutput, { flag: "wx" });
  }
  return result;
};
syncBuiltinESMExports();

process.on("exit", () => {
  if (!injected) {
    process.stderr.write("Armorial candidate output race probe did not reach publication.\n");
    process.exitCode = 97;
  }
});
}
