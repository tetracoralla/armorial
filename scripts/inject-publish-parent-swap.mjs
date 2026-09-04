import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const mode = process.env.ARMORIAL_PUBLISH_PARENT_SWAP_MODE;
const targetParent = process.env.ARMORIAL_PUBLISH_PARENT_SWAP_TARGET;
const backupParent = process.env.ARMORIAL_PUBLISH_PARENT_SWAP_BACKUP;
const outsideParent = process.env.ARMORIAL_PUBLISH_PARENT_SWAP_OUTSIDE;
const isPublishHelper = process.argv.some((argument) => String(argument).includes("publish-helper"));

if (
  !["before-spawn", "after-cwd-pin"].includes(mode ?? "")
  || !targetParent
  || !backupParent
  || !outsideParent
) throw new Error("The parent-swap probe requires a mode and exact target, backup, and outside directories.");

let injected = false;
function swapParent() {
  if (injected) return;
  injected = true;
  fs.renameSync(targetParent, backupParent);
  fs.symlinkSync(outsideParent, targetParent, "dir");
}

const activeInThisProcess = mode === "before-spawn" ? !isPublishHelper : isPublishHelper;

if (activeInThisProcess && mode === "before-spawn") {
  const originalSpawn = childProcess.spawn.bind(childProcess);
  childProcess.spawn = (command, args, options) => {
    if (
      !injected
      && Array.isArray(args)
      && args.some((argument) => String(argument).includes("publish-helper"))
    ) swapParent();
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();
} else if (activeInThisProcess) {
  const originalStat = fs.promises.stat.bind(fs.promises);
  fs.promises.stat = async (path, options) => {
    const result = await originalStat(path, options);
    if (!injected && path === "." && process.argv.some((argument) => argument.includes("publish-helper"))) {
      swapParent();
    }
    return result;
  };
  syncBuiltinESMExports();
}

if (activeInThisProcess) {
  process.on("exit", () => {
    if (!injected) {
      process.stderr.write(`Armorial parent-swap probe did not inject ${mode}.\n`);
      process.exitCode = 97;
    }
  });
}
