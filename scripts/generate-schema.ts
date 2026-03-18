/**
 * Emit dist/config.schema.json from Effect Schema.
 * Run at build time: bun run scripts/generate-schema.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { RawEmailConfigSchema, RawSignalConfigSchema } from "../src/shell/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "dist", "config.schema.json");

/** Union of Signal and Email config — config file can contain both (used by either pipeline). */
const ConfigSchema = Schema.Union([RawSignalConfigSchema, RawEmailConfigSchema]);

const document = Schema.toJsonSchemaDocument(ConfigSchema);
const json = JSON.stringify(document, null, 2);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, json, "utf8");
console.log(`Wrote ${outPath}`);
