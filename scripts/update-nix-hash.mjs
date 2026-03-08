#!/usr/bin/env node

/**
 * Updates npmDepsHash in default.nix. For contributors without Nix.
 * Usage: node scripts/update-nix-hash.mjs <sha256-hash>
 * Or: npm run update-nix-hash -- sha256-...
 *
 * The hash can be obtained from the failed nix CI job: expand the
 * "Verify npmDepsHash" step and copy it from the "Without Nix: ..." line.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hash = process.argv[2]?.trim();
if (!hash || !hash.startsWith("sha256-")) {
	console.error("Usage: node scripts/update-nix-hash.mjs <sha256-hash>");
	process.exit(1);
}

const defaultNixPath = path.resolve(__dirname, "..", "default.nix");
const content = fs.readFileSync(defaultNixPath, "utf8");

if (!content.includes('npmDepsHash = "sha256-')) {
	console.error("No npmDepsHash found in default.nix");
	process.exit(1);
}

const updated = content.replace(/npmDepsHash = "sha256-[^"]*"/, `npmDepsHash = "${hash}"`);

if (content === updated) {
	console.log("Hash already correct");
	process.exit(0);
}

fs.writeFileSync(defaultNixPath, updated);
console.log("Updated npmDepsHash in default.nix");
