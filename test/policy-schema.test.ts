import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { DEFAULT_POLICY, IconPolicySchema } from "../src/core/contracts.js";
import { createPolicyJsonSchema } from "../src/core/policy-schema.js";

function policyWithPrimary(primary: string): unknown {
  const policy = structuredClone(DEFAULT_POLICY);
  policy.defaults.colors.primary = primary;
  return policy;
}

test("published policy JSON Schema agrees with representable runtime structural validation", () => {
  const validateJsonSchema = new Ajv2020({ strict: true }).compile(createPolicyJsonSchema());
  const cases: readonly { label: string; input: unknown; valid: boolean }[] = [
    { label: "default policy", input: structuredClone(DEFAULT_POLICY), valid: true },
    { label: "case-insensitive named color", input: policyWithPrimary("Red"), valid: true },
    { label: "case-insensitive currentColor", input: policyWithPrimary("CURRENTCOLOR"), valid: true },
    { label: "case-insensitive long named color", input: policyWithPrimary("RebeccaPurple"), valid: true },
    { label: "malformed hex", input: policyWithPrimary("#12345"), valid: false },
    { label: "unknown named color", input: policyWithPrimary("notacolor"), valid: false },
    {
      label: "missing required collection",
      input: { ...structuredClone(DEFAULT_POLICY), collections: [] },
      valid: false,
    },
    {
      label: "duplicate collection",
      input: { ...structuredClone(DEFAULT_POLICY), collections: ["icon-park", "icon-park"] },
      valid: false,
    },
    {
      label: "unknown top-level property",
      input: { ...structuredClone(DEFAULT_POLICY), invented: true },
      valid: false,
    },
    {
      label: "too many contexts",
      input: {
        ...structuredClone(DEFAULT_POLICY),
        contexts: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`context-${index}`, {}])),
      },
      valid: false,
    },
    {
      label: "too many semantic selections",
      input: {
        ...structuredClone(DEFAULT_POLICY),
        selections: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`intent-${index}`, "search"])),
      },
      valid: false,
    },
    {
      label: "invalid selected icon id",
      input: {
        ...structuredClone(DEFAULT_POLICY),
        selections: { search: "icon park:search" },
      },
      valid: false,
    },
  ];

  for (const fixture of cases) {
    const runtimeValid = IconPolicySchema.safeParse(fixture.input).success;
    const schemaValid = validateJsonSchema(fixture.input) as boolean;
    assert.equal(runtimeValid, fixture.valid, `${fixture.label}: runtime`);
    assert.equal(schemaValid, fixture.valid, `${fixture.label}: JSON Schema`);
  }

  const parsed = IconPolicySchema.parse(policyWithPrimary("CURRENTCOLOR"));
  assert.equal(parsed.defaults.colors.primary, "currentColor");
});
