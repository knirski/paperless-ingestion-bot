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

	test("multi-commit new PR: body includes all commits, title from Ollama or fallback", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/multi-commit");
			writeFile(path.join(tmp.path, "src/a.ts"), "a;\n");
			runGit(tmp.path, "add", "src/a.ts");
			runGit(tmp.path, "commit", "-m", "feat: add module A");
			writeFile(path.join(tmp.path, "src/b.ts"), "b;\n");
			runGit(tmp.path, "add", "src/b.ts");
			runGit(tmp.path, "commit", "-m", "feat: add module B");

			// Simulates: ai/* pushed with 2+ commits, no PR yet → create PR with all commits
			const output = await Effect.runPromise(
				runFillBody("main", undefined, "title-body", {
					aiTitle: true,
					ollamaUrl: "http://127.0.0.1:19999", // Ollama unavailable → fallback to getTitle
				}).pipe(Effect.provide(testLayer(tmp.path))),
			);

			const lines = output.split("\n");
			expect(lines[0]).toBe("feat: add module B"); // getTitle = newest commit (git log order)
			expect(output).toContain("feat: add module A");
			expect(output).toContain("feat: add module B");
			expect(output).toContain("## Changes made");
		} finally {
			await tmp.remove();
		}
	});

	test("non-conventional commits are included in body and title input", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/non-conventional");
			writeFile(path.join(tmp.path, "src/x.ts"), "x;\n");
			runGit(tmp.path, "add", "src/x.ts");
			runGit(tmp.path, "commit", "-m", "wip: messy commit");
			writeFile(path.join(tmp.path, "src/y.ts"), "y;\n");
			runGit(tmp.path, "add", "src/y.ts");
			runGit(tmp.path, "commit", "-m", "feat: add y");

			const output = await Effect.runPromise(
				runFillBody("main", undefined, "title-body").pipe(Effect.provide(testLayer(tmp.path))),
			);
			expect(output).toContain("wip: messy commit");
			expect(output).toContain("feat: add y");
		} finally {
			await tmp.remove();
		}
	});

	test("merge commits are filtered from body and title", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/merge-test");
			writeFile(path.join(tmp.path, "src/foo.ts"), "foo;\n");
			runGit(tmp.path, "add", "src/foo.ts");
			runGit(tmp.path, "commit", "-m", "feat: add foo");
			runGit(tmp.path, "checkout", "main");
			writeFile(path.join(tmp.path, "README.md"), "# Test\n\nUpdated.\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: update readme");
			runGit(tmp.path, "checkout", "ai/merge-test");
			runGit(tmp.path, "merge", "main", "-m", "Merge branch 'main' into ai/merge-test");

			const output = await Effect.runPromise(
				runFillBody("main", undefined, "title-body").pipe(Effect.provide(testLayer(tmp.path))),
			);
			expect(output).toContain("feat: add foo");
			expect(output).not.toContain("Merge branch");
		} finally {
			await tmp.remove();
		}
	});

	test("update PR: new commits pushed → body and title include ALL commits", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/update-pr");
			writeFile(path.join(tmp.path, "src/first.ts"), "1;\n");
			runGit(tmp.path, "add", "src/first.ts");
			runGit(tmp.path, "commit", "-m", "feat: first commit");

			// First run (simulates initial PR create)
			const output1 = await Effect.runPromise(
				runFillBody("main", undefined, "title-body").pipe(Effect.provide(testLayer(tmp.path))),
			);
			expect(output1).toContain("feat: first commit");
			expect(output1).not.toContain("feat: second commit");

			// Push new commit (simulates: PR exists, new commit pushed)
			writeFile(path.join(tmp.path, "src/second.ts"), "2;\n");
			runGit(tmp.path, "add", "src/second.ts");
			runGit(tmp.path, "commit", "-m", "feat: second commit");

			// Second run (simulates: workflow runs again, updates PR)
			const output2 = await Effect.runPromise(
				runFillBody("main", undefined, "title-body").pipe(Effect.provide(testLayer(tmp.path))),
			);
			expect(output2).toContain("feat: first commit");
			expect(output2).toContain("feat: second commit");
		} finally {
			await tmp.remove();
		}
	});

	test("aiTitle falls back to getTitle when Ollama unavailable", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/feature-ollama");
			writeFile(path.join(tmp.path, "src/ollama.ts"), "x;\n");
			runGit(tmp.path, "add", "src/ollama.ts");
			runGit(tmp.path, "commit", "-m", "feat(ci): add Ollama PR title generation");

			// Ollama not running → generateTitleViaOllama fails → fallback to getTitle
			const output = await Effect.runPromise(
				runFillBody("main", undefined, "title-body", {
					aiTitle: true,
					ollamaUrl: "http://127.0.0.1:19999", // non-existent port
				}).pipe(Effect.provide(testLayer(tmp.path))),
			);

			const lines = output.split("\n");
			expect(lines[0]).toBe("feat(ci): add Ollama PR title generation");
			expect(lines[1]).toBe("");
			expect(output).toContain("## Description");
		} finally {
			await tmp.remove();
		}
	});

	test("format title-body outputs first line as PR title (first commit subject)", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/feature-x");
			writeFile(path.join(tmp.path, "src/x.ts"), "x;\n");
			runGit(tmp.path, "add", "src/x.ts");
			runGit(tmp.path, "commit", "-m", "fix(ci): automate npmDepsHash updates via CI");

			const output = await Effect.runPromise(
				runFillBody("main", undefined, "title-body").pipe(Effect.provide(testLayer(tmp.path))),
			);

			const lines = output.split("\n");
			expect(lines[0]).toBe("fix(ci): automate npmDepsHash updates via CI");
			expect(lines[1]).toBe("");
			expect(output).toContain("## Description");
		} finally {
			await tmp.remove();
		}
	});

	test("format title-body fails when no commits (empty title)", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		try {
			runGit(tmp.path, "init", "-b", "main");
			runGit(tmp.path, "config", "user.email", "test@example.com");
			runGit(tmp.path, "config", "user.name", "Test User");

			await writeTestFile(path.join(tmp.path, "README.md"), "# Test\n");
			runGit(tmp.path, "add", "README.md");
			runGit(tmp.path, "commit", "-m", "chore: initial");

			setupTemplate(tmp.path);

			runGit(tmp.path, "checkout", "-b", "ai/empty");
			// No commits ahead of main → empty title

			const program = runFillBody("main", undefined, "title-body").pipe(
				Effect.provide(testLayer(tmp.path)),
			);

			await expect(Effect.runPromise(program)).rejects.toThrow(
				"PR title is empty. Add at least one non-merge commit",
			);
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
