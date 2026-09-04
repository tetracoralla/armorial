import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const isPublishHelper = process.argv.some((argument) => String(argument).includes("publish-helper"));

if (isPublishHelper) {
  const failure = process.env.ARMORIAL_TEST_PUBLISH_HELPER_FAILURE;
  if (!["exit-before-write", "open-failure", "partial-write", "partial-write-cleanup-failure", "close-failure", "post-commit-cleanup-failure", "exit-after-publication", "throw-after-publication"].includes(failure ?? "")) {
    throw new Error("The publisher failure probe requires a declared open, write, close, or cleanup sequence.");
  }

  const originalOpen = fs.promises.open.bind(fs.promises);
  const originalRm = fs.promises.rm.bind(fs.promises);
  let injected = false;
  let cleanupInjected = false;
  fs.promises.open = async (path, ...args) => {
    if (
      !injected
      && String(path).startsWith(".armorial-publish-")
      && String(path).endsWith(".tmp")
    ) {
      injected = true;
      if (failure === "exit-before-write") process.exit(91);
      if (failure === "open-failure") throw new Error("Injected test-only publisher open failure.");
      const handle = await originalOpen(path, ...args);
      if (failure === "close-failure") {
        const originalClose = handle.close.bind(handle);
        handle.close = async () => {
          await originalClose();
          throw new Error("Injected test-only publisher close failure.");
        };
      }
      if (failure === "partial-write" || failure === "partial-write-cleanup-failure") {
        const originalWriteFile = handle.writeFile.bind(handle);
        handle.writeFile = async (data, options) => {
          const bytes = Buffer.from(data);
          await originalWriteFile(bytes.subarray(0, Math.max(1, Math.floor(bytes.byteLength / 2))), options);
          throw new Error("Injected test-only partial publisher failure.");
        };
      }
      return handle;
    }
    return originalOpen(path, ...args);
  };
  fs.promises.rm = async (path, ...args) => {
    if (
      (failure === "partial-write-cleanup-failure" || failure === "post-commit-cleanup-failure")
      && !cleanupInjected
      && String(path).startsWith(".armorial-publish-")
      && String(path).endsWith(".tmp")
    ) {
      cleanupInjected = true;
      if (failure === "partial-write-cleanup-failure") await originalRm(path, ...args);
      throw new Error("Injected test-only cleanup failure after removal.");
    }
    return originalRm(path, ...args);
  };
  syncBuiltinESMExports();

  if (failure === "exit-after-publication" || failure === "throw-after-publication") {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...writeArgs) => {
      if (String(chunk).includes('"status":"ok"')) {
        if (failure === "exit-after-publication") process.exit(92);
        throw new Error("Injected test-only response failure after publication.");
      }
      return originalStdoutWrite(chunk, ...writeArgs);
    };
  }

  process.on("exit", () => {
    if (!injected) {
      process.stderr.write(`Armorial publisher failure probe did not inject ${failure}.\n`);
      process.exitCode = 97;
    }
    if ((failure === "partial-write-cleanup-failure" || failure === "post-commit-cleanup-failure") && !cleanupInjected) {
      process.stderr.write("Armorial publisher cleanup precedence probe did not inject cleanup failure.\n");
      process.exitCode = 98;
    }
  });
}
