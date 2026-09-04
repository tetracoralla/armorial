import { writeFileSync } from "node:fs";

const isPublishHelper = process.argv.some((argument) => String(argument).includes("publish-helper"));

if (isPublishHelper) {
  const marker = process.env.ARMORIAL_TEST_PUBLISH_READY_MARKER;
  const originalSend = process.send?.bind(process);
  if (!marker || originalSend === undefined) {
    throw new Error("The parent-cancellation probe requires an IPC helper and one exact ready marker.");
  }
  let intercepted = false;
  process.send = (message, ...args) => {
    if (
      !intercepted
      && typeof message === "object"
      && message !== null
      && message.status === "ready"
    ) {
      intercepted = true;
      writeFileSync(marker, `${JSON.stringify({ pid: process.pid })}\n`, { flag: "wx" });
      // Do not deliver readiness to the parent. The probe now has a stable
      // prepared-but-uncommitted point at which it can terminate only the CLI.
      return true;
    }
    return originalSend(message, ...args);
  };
}
