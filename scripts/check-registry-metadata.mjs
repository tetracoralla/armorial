import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8"));
const serverJson = JSON.parse(readFileSync(resolve(workspace, "server.json"), "utf8"));

assert.equal(serverJson.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
assert.equal(packageJson.mcpName, serverJson.name, "npm ownership metadata must match the MCP server name");
assert.equal(serverJson.version, packageJson.version, "MCP and npm package versions must match");
assert.equal(serverJson.packages?.length, 1, "Armorial publishes exactly one Registry package route");

const registryPackage = serverJson.packages[0];
assert.equal(registryPackage.registryType, "npm");
assert.equal(registryPackage.identifier, packageJson.name);
assert.equal(registryPackage.version, packageJson.version);
assert.equal(registryPackage.runtimeHint, "npx");
assert.deepEqual(registryPackage.transport, { type: "stdio" });
assert.deepEqual(
  registryPackage.packageArguments,
  [{ type: "positional", value: "mcp" }],
  "Registry clients must start the MCP subcommand instead of the human CLI",
);
assert.equal(packageJson.bin?.[packageJson.name], "./dist/adapters/cli.js");

process.stdout.write(`${JSON.stringify({
  status: "ok",
  server: serverJson.name,
  version: serverJson.version,
  invocation: `npx ${registryPackage.identifier}@${registryPackage.version} mcp`,
})}\n`);
