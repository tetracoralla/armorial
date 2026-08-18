import {
  IconSelectionDecisionInputSchema,
  IconSelectionDecisionSchema,
  type IconSelectionDecision,
  type IconSelectionDecisionInput,
} from "./contracts.js";

function stableDecisionPayload(input: IconSelectionDecisionInput): string {
  return JSON.stringify({
    kind: "icon_selection",
    version: 2,
    requestId: input.requestId ?? null,
    iconId: input.iconId,
    intent: input.intent,
    context: input.context,
    render: input.render,
    assetSha256: input.assetSha256,
    scope: "current_task",
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createIconSelectionDecision(
  input: IconSelectionDecisionInput,
): Promise<IconSelectionDecision> {
  const parsed = IconSelectionDecisionInputSchema.parse(input);
  const decisionId = await sha256(stableDecisionPayload(parsed));
  return IconSelectionDecisionSchema.parse({
    kind: "icon_selection",
    version: 2,
    decisionId,
    ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
    iconId: parsed.iconId,
    intent: parsed.intent,
    context: parsed.context,
    render: parsed.render,
    assetSha256: parsed.assetSha256,
    scope: "current_task",
  });
}

export function formatIconSelectionMessage(decision: IconSelectionDecision): string {
  const value = IconSelectionDecisionSchema.parse(decision);
  return [
    "[icon-selection:v2]",
    JSON.stringify(value, null, 2),
    "Use this exact human-selected icon via get_icon with this id and render style, then continue the current task. Do not re-search or redraw it.",
  ].join("\n");
}
