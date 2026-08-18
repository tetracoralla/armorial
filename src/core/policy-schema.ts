import { z } from "zod";
import {
  ContextsSchema,
  IconPolicySchema,
  MAX_POLICY_CONTEXTS,
  MAX_POLICY_SELECTIONS,
  SelectionsSchema,
} from "./contracts.js";

export function createPolicyJsonSchema(): Record<string, unknown> {
  return {
    $id: "https://icon-svg-select.local/icon-policy.schema.json",
    title: "Armorial Policy",
    description: "Executable IconPark rendering and semantic-selection policy.",
    ...z.toJSONSchema(IconPolicySchema, {
      target: "draft-2020-12",
      unrepresentable: "throw",
      reused: "ref",
      override: ({ zodSchema, jsonSchema }) => {
        if (zodSchema === ContextsSchema) jsonSchema.maxProperties = MAX_POLICY_CONTEXTS;
        if (zodSchema === SelectionsSchema) jsonSchema.maxProperties = MAX_POLICY_SELECTIONS;
      },
    }),
  };
}
