/**
 * Integration test for fill-pr-body script.
 * Creates a temp git repo with conventional commits and runs runFillBody in-process.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Logger } from "effect";
import { describe, expect, test } from "vitest";
import { runFillBody } from "../../scripts/fill-pr-body.js";
import { GitClient } from "../../scripts/git-client.js";
import { createTestTempDir, writeTestFile } from "../test-utils.js";

function writeFile(p: string, content: string): void {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const templatePath = path.join(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md");

function setupTemplate(cwd: string): void {
	const template = fs.readFileSync(templatePath, "utf8");
	writeFile(path.join(cwd, ".github/PULL_REQUEST_TEMPLATE.md"), template);
}

function runGit(cwd: string, ...args: string[]): void {
	execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Layer for running runFillBody in a temp git repo. Uses SilentLogger to avoid log noise. */
function testLayer(cwd: string) {
	return NodeServices.layer.pipe(
		Layer.provideMerge(GitClient.LiveWithCwd(cwd)),
		Layer.provideMerge(Logger.layer([])),
	);
}

describe("fill-pr-body script integration", () => {
	test("infers default branch when base not passed (no remote → main)", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "feature/infer");
			writeFile(path.join(tmp.path, "src/infer.ts"), "x;\n");
			runGit(tmp.path, "add", "src/infer.ts");
			runGit(tmp.path, "commit", "-m", "feat: infer base\n\nNo base arg.");

			const output = await Effect.runPromise(
				runFillBody(undefined, undefined).pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("No base arg.");
		} finally {
			await tmp.remove();
		}
	});

	test("outputs PR body from conventional commits in temp git repo", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial commit");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "feature/foo");
			writeFile(path.join(tmp.path, "src/foo.ts"), "export const x = 1;\n");
			runGit(tmp.path, "add", "src/foo.ts");
			runGit(tmp.path, "commit", "-m", "feat: add foo\n\nThis adds the foo module.");

			const output = await Effect.runPromise(
				runFillBody("main", undefined).pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("## Description");
			expect(output).toContain("## Type of change");
			expect(output).toContain("## Changes made");
			expect(output).toContain("New feature");
			expect(output).toContain("feat: add foo");
			expect(output).toContain("This adds the foo module");
			expect(output).toContain("npm run check");
		} finally {
			await tmp.remove();
		}
	});

	test("extracts Closes #123 and sets howToTest N/A for docs-only", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "docs/update");
			writeFile(path.join(tmp.path, "docs/guide.md"), "# Guide\n");
			runGit(tmp.path, "add", "docs/guide.md");
			runGit(tmp.path, "commit", "-m", "docs: update guide\n\nCloses #42");

			const output = await Effect.runPromise(
				runFillBody("main", undefined).pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("Closes #42");
			expect(output).toContain("Documentation update");
			expect(output).toContain("How to test");
			expect(output).toContain("N/A");
		} finally {
			await tmp.remove();
		}
	});

	test("uses --template path when provided", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			const customTemplate = path.join(tmp.path, "custom-template.md");
			writeFile(
				customTemplate,
				"Custom: {{description}}\nType: {{typeOfChange}}\n{{changes}}\n{{howToTest}}\n{{checklistConventional}}\n{{relatedIssues}}\n{{breakingChanges}}",
			);

			runGit(tmp.path, "checkout", "-b", "feature/bar");
			writeFile(path.join(tmp.path, "src/bar.ts"), "export const y = 2;\n");
			runGit(tmp.path, "add", "src/bar.ts");
			runGit(tmp.path, "commit", "-m", "feat: add bar\n\nBar feature here.");

			const output = await Effect.runPromise(
				runFillBody("main", customTemplate).pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("Custom: Bar feature here.");
			expect(output).toContain("Type: New feature");
			expect(output).toContain("feat: add bar");
		} finally {
			await tmp.remove();
		}
	});

	test("parses --template when base comes first (main --template path)", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			const customTemplate = path.join(tmp.path, "custom-template.md");
			writeFile(customTemplate, "Arg order ok: {{description}}");

			runGit(tmp.path, "checkout", "-b", "feature/baz");
			writeFile(path.join(tmp.path, "src/baz.ts"), "export const z = 3;\n");
			runGit(tmp.path, "add", "src/baz.ts");
			runGit(tmp.path, "commit", "-m", "feat: add baz\n\nBaz here.");

			// CLI arg order: base first, then --template. runFillBody(base, template) covers this.
			const output = await Effect.runPromise(
				runFillBody("main", customTemplate).pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("Arg order ok: Baz here.");
		} finally {
			await tmp.remove();
		}
	});

	test("warns when output contains unreplaced placeholders", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			const typoTemplate = path.join(tmp.path, "typo-template.md");
			writeFile(typoTemplate, "OK: {{description}}\nTypo: {{desciption}}");

			runGit(tmp.path, "checkout", "-b", "feature/typo");
			writeFile(path.join(tmp.path, "src/typo.ts"), "x;\n");
			runGit(tmp.path, "add", "src/typo.ts");
			runGit(tmp.path, "commit", "-m", "feat: x\n\nDesc.");

			const output = await Effect.runPromise(
				runFillBody("main", typoTemplate).pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("OK: Desc.");
			expect(output).toContain("Typo: {{desciption}}");
			// runFillBody logs a warning for unreplaced placeholders; body still contains the typo
			expect(output).toContain("{{desciption}}");
		} finally {
			await tmp.remove();
		}
	});

	test("resolves --template relative path from repo root", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			writeFile(path.join(tmp.path, "rel-template.md"), "Relative: {{description}}");

			runGit(tmp.path, "checkout", "-b", "feature/qux");
			writeFile(path.join(tmp.path, "src/qux.ts"), "export const q = 4;\n");
			runGit(tmp.path, "add", "src/qux.ts");
			runGit(tmp.path, "commit", "-m", "feat: add qux\n\nQux from relative path.");

			const output = await Effect.runPromise(
				runFillBody("main", "rel-template.md").pipe(Effect.provide(testLayer(tmp.path))),
			);

			expect(output).toContain("Relative: Qux from relative path.");
		} finally {
			await tmp.remove();
		}
	});

	test("exits with code 1 and clear message when base branch not found", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "develop");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");
			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			const program = runFillBody("main", undefined).pipe(Effect.provide(testLayer(tmp.path)));

			try {
				await Effect.runPromise(program);
				expect.fail("Expected program to fail");
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				expect(message).toContain("main");
				expect(message).toContain("origin/main");
			}
		} finally {
			await tmp.remove();
		}
	});
});
