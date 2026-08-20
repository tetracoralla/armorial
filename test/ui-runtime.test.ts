import assert from "node:assert/strict";
import { test } from "node:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import { DEFAULT_POLICY, type IconSelectionDecision } from "../src/core/contracts.js";
import { EmbeddedRuntime } from "../src/ui/runtime.js";

type HostCall = { method: "updateModelContext" | "sendMessage"; input: unknown };

function embeddedRuntimeWithHost(options: { rejectMessage?: boolean } = {}): {
  runtime: EmbeddedRuntime;
  calls: HostCall[];
} {
  const calls: HostCall[] = [];
  const runtime = new EmbeddedRuntime(
    {
      getHostCapabilities: () => ({
        updateModelContext: () => undefined,
        message: () => undefined,
      }),
      getHostContext: () => null,
      updateModelContext: async (input: unknown) => {
        calls.push({ method: "updateModelContext", input });
        return {};
      },
      sendMessage: async (input: unknown) => {
        calls.push({ method: "sendMessage", input });
        return { isError: options.rejectMessage === true };
      },
    } as unknown as App,
    { catalog: null, session: null, listeners: new Set() },
  );
  return { runtime, calls };
}

const decision: IconSelectionDecision = {
  kind: "icon_selection",
  version: 3,
  decisionId: "a".repeat(64),
  iconId: "icon-park:remind",
  intent: "notification",
  context: null,
  render: structuredClone(DEFAULT_POLICY.defaults),
  assetSha256: "b".repeat(64),
  scope: "current_task",
};

test("select-and-continue commits exactly one user-role decision message", async () => {
  const { runtime, calls } = embeddedRuntimeWithHost();
  const message = "[icon-selection:v3] …decision text…";
  await runtime.continueTask(message);
  assert.deepEqual(calls.map((call) => call.method), ["sendMessage"]);
  const sent = calls[0]?.input as { role?: string; content?: Array<{ type?: string; text?: string }> };
  assert.equal(sent.role, "user");
  assert.equal(sent.content?.[0]?.text, message);
});

test("a rejected continue message leaves no committed host context behind", async () => {
  const { runtime, calls } = embeddedRuntimeWithHost({ rejectMessage: true });
  await assert.rejects(() => runtime.continueTask("[icon-selection:v3] …"), /rejected/);
  assert.deepEqual(calls.map((call) => call.method), ["sendMessage"]);
});

test("attach updates model context with the typed decision and sends no message", async () => {
  const { runtime, calls } = embeddedRuntimeWithHost();
  await runtime.attach(decision, "[icon-selection:v3] …");
  assert.deepEqual(calls.map((call) => call.method), ["updateModelContext"]);
  const attached = calls[0]?.input as { structuredContent?: { iconSelection?: IconSelectionDecision } };
  assert.deepEqual(attached.structuredContent?.iconSelection, decision);
});
