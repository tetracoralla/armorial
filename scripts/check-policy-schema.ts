import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPolicyJsonSchema } from "../src/core/policy-schema.js";

const schemaPath = resolve(process.cwd(), "icon-policy.schema.json");
const expected = `${JSON.stringify(createPolicyJsonSchema(), null, 2)}\n`;
const actual = await readFile(schemaPath, "utf8");
const MAX_GENERATED_SCHEMA_BYTES = 24 * 1024;

if (actual !== expected) {
  process.stderr.write("icon-policy.schema.json is stale. Run npm run schema:generate.\n");
  process.exitCode = 1;
}

if (Buffer.byteLength(actual, "utf8") > MAX_GENERATED_SCHEMA_BYTES) {
  process.stderr.write(`icon-policy.schema.json exceeds the ${MAX_GENERATED_SCHEMA_BYTES}-byte budget.\n`);
  process.exitCode = 1;
}
