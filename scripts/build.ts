#!/usr/bin/env bun
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const src = join(root, "src");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const result = await Bun.build({
	entrypoints: [join(src, "cli.ts")],
	outdir: dist,
	root: src,
	format: "esm",
	target: "node",
	minify: true,
	sourcemap: "linked",
	banner: "#!/usr/bin/env bun\n",
	naming: "[name].js",
});

if (!result.success) {
	process.stderr.write(`Build failed:\n${result.logs.map(String).join("\n")}\n`);
	process.exit(1);
}

// Generate config schema (Bun runs TS directly)
const schemaProc = Bun.spawn(["bun", "run", join(root, "scripts/generate-schema.ts")], {
	cwd: root,
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await schemaProc.exited;
if (exitCode !== 0) {
	process.exit(exitCode ?? 1);
}
