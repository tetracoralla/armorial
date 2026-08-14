import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPolicyJsonSchema } from "../src/core/policy-schema.js";

const outputPath = resolve(process.cwd(), "icon-policy.schema.json");
await writeFile(outputPath, `${JSON.stringify(createPolicyJsonSchema(), null, 2)}\n`, "utf8");
