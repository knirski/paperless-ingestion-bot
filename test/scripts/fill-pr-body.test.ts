import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Logger, Option, Result } from "effect";
import { describe, expect, test } from "vitest";
import {
	fillTemplate,
	filterMergeCommits,
	getBreakingChanges,
	getChanges,
	getDescription,
	getRelatedIssues,
	hasDocsFiles,
	hasTestFiles,
	inferTypeOfChange,
	isConventional,
	isDocsOnly,
	isMergeCommit,
	isValidConventionalTitle,
	ParseError,
	parseCommits,
	renderBody,
	renderFromTemplate,
	runFillBody,
} from "../../scripts/fill-pr-body.js";
import { createTestTempDir, SilentLoggerLayer } from "../test-utils.js";

const TEST_TEMPLATE = `## Description
{{description}}

## Type of change
**{{typeOfChange}}**. See [Conventional Commits](https://www.conventionalcommits.org/).

## Changes made
{{changes}}

## How to test
{{howToTest}}

## Checklist
- [{{checklistConventional}}] My commits follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] I have run \`npm run check\` and fixed any issues
- [{{checklistDocs}}] I have updated the documentation if needed
- [{{checklistTests}}] I have added or updated tests for my changes

## Related issues
{{relatedIssues}}

## Breaking changes
{{breakingChanges}}
`;

const commit = (
	subject: string,
	body: string,
	opts?: { type?: string; references?: string[]; breakingNote?: string | null },
) => ({
	subject,
	body,
	fullMessage: `${subject}\n\n${body}`.trim(),
	type: opts?.type ?? null,
	references: opts?.references ?? [],
	breakingNote: opts?.breakingNote ?? null,
});

/** Format commit blocks for parseCommits (---COMMIT--- separated). */
function logContent(...blocks: Array<{ subject: string; body: string }>): string {
	const formatted = blocks.map((b) => (b.body ? `${b.subject}\n\n${b.body}`.trim() : b.subject));
	return `---COMMIT---\n${formatted.join("\n---COMMIT---\n")}`;
}

/** Write log and files to temp dir, run runFillBody, return output. No git. */
async function runWithLogAndFiles(
	logStr: string,
	filesStr: string,
	opts?: {
		templatePath?: string;
		format?: "body" | "title-body";
	},
): Promise<string> {
	const tmp = await createTestTempDir("fill-pr-body-");
	const testLayer = NodeServices.layer.pipe(Layer.provideMerge(Logger.layer([])));
	try {
		const logFile = path.join(tmp.path, "commits.txt");
		const filesFile = path.join(tmp.path, "files.txt");
		fs.writeFileSync(logFile, logStr);
		fs.writeFileSync(filesFile, filesStr);
		return await Effect.runPromise(
			runFillBody(logFile, filesFile, opts?.templatePath, opts?.format ?? "body").pipe(
				Effect.provide(testLayer),
			),
		);
	} finally {
		await tmp.remove();
	}
}

// ─── Pure function tests ────────────────────────────────────────────────────

describe("parseCommits", () => {
	test("parses single commit", () => {
		const log = "---COMMIT---\nfeat: add foo\nbody line 1";
		const out = parseCommits(log);
		expect(Result.isSuccess(out)).toBe(true);
		if (Result.isSuccess(out)) {
			expect(out.success).toHaveLength(1);
			expect(out.success[0]?.subject).toBe("feat: add foo");
			expect(out.success[0]?.body).toBe("body line 1");
			expect(out.success[0]?.type).toBe("feat");
		}
	});

	test("parses multiple commits", () => {
		const log = "---COMMIT---\nfeat: first\n\n---COMMIT---\nfix: second\nbody";
		const out = parseCommits(log);
		expect(Result.isSuccess(out)).toBe(true);
		if (Result.isSuccess(out)) {
			expect(out.success).toHaveLength(2);
			expect(out.success[0]?.subject).toBe("feat: first");
			expect(out.success[1]?.subject).toBe("fix: second");
			expect(out.success[1]?.body).toBe("body");
		}
	});

	test("returns empty for empty input", () => {
		const out = parseCommits("");
		expect(Result.isSuccess(out)).toBe(true);
		if (Result.isSuccess(out)) expect(out.success).toEqual([]);
	});
});

describe("ParseError", () => {
	test("has _tag and extends Error", () => {
		const err = new ParseError("test", new Error("cause"));
		expect(err._tag).toBe("ParseError");
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toBe("test");
		expect(err.cause).toBeInstanceOf(Error);
		expect((err.cause as Error).message).toBe("cause");
	});
});

describe("inferTypeOfChange", () => {
	test("feat → New feature", () => {
		expect(inferTypeOfChange([commit("feat: x", "")])).toBe("New feature");
	});

	test("fix → Bug fix", () => {
		expect(inferTypeOfChange([commit("fix: y", "")])).toBe("Bug fix");
	});

	test("docs → Documentation update", () => {
		expect(inferTypeOfChange([commit("docs: z", "")])).toBe("Documentation update");
	});

	test("chore → Chore", () => {
		expect(inferTypeOfChange([commit("chore: a", "")])).toBe("Chore");
	});

	test("perf → Chore", () => {
		const commits = [commit("perf: speed up", "", { type: "perf" })];
		expect(inferTypeOfChange(commits)).toBe("Chore");
	});

	test("revert → Chore", () => {
		const commits = [commit("revert: undo feat", "", { type: "revert" })];
		expect(inferTypeOfChange(commits)).toBe("Chore");
	});

	test("BREAKING CHANGE in body → Breaking change", () => {
		expect(
			inferTypeOfChange([
				commit("feat: x", "BREAKING CHANGE: removed API", {
					breakingNote: "removed API",
				}),
			]),
		).toBe("Breaking change");
	});

	test("feat! → Breaking change", () => {
		expect(inferTypeOfChange([commit("feat!: x", "")])).toBe("Breaking change");
	});

	test("empty commits → Chore", () => {
		expect(inferTypeOfChange([])).toBe("Chore");
	});
});

describe("getDescription", () => {
	test("uses body when not Closes/Fixes, collapses newlines within paragraph for PR", () => {
		const c = commit("feat: add x", "This adds the x feature.\nMore details.");
		expect(getDescription(c)).toBe("This adds the x feature. More details.");
	});

	test("preserves paragraph breaks (blank lines) in body", () => {
		const c = commit(
			"feat: add x",
			"First paragraph line one.\nFirst paragraph line two.\n\nSecond paragraph.",
		);
		expect(getDescription(c)).toBe(
			"First paragraph line one. First paragraph line two.\n\nSecond paragraph.",
		);
	});

	test("preserves bullet lists (remark AST)", () => {
		const c = commit(
			"feat: add x",
			"- Count only semantic commits\n- Move CI scripts to .github/scripts/\n- Sanitize GITHUB_OUTPUT",
		);
		const desc = getDescription(c);
		expect(desc).toContain("Count only semantic commits");
		expect(desc).toContain("Move CI scripts to .github/scripts/");
		expect(desc).toContain("Sanitize GITHUB"); // remark may escape _ in OUTPUT
	});

	test("preserves code blocks (remark AST)", () => {
		const c = commit("feat: add x", "Use:\n\n```\nPR_NUMBER=123 python script.py\n```");
		expect(getDescription(c)).toContain("Use:");
		expect(getDescription(c)).toContain("```");
		expect(getDescription(c)).toContain("PR_NUMBER=123 python script.py");
	});

	test("collapses prose but preserves mixed content", () => {
		const c = commit(
			"feat: add x",
			"Release Please force-pushes frequently, which was cancelling CI runs\nbefore they completed. Branch protection requires a successful check.\n\n- Set cancel-in-progress to false",
		);
		const desc = getDescription(c);
		expect(desc).toContain("Release Please force-pushes frequently");
		expect(desc).toContain("before they completed");
		expect(desc).toContain("Set cancel-in-progress to false");
	});

	test("uses subject after colon when body starts with Closes", () => {
		const c = commit("feat: add x", "Closes #123", { references: ["Closes #123"] });
		expect(getDescription(c)).toBe("add x");
	});

	test("returns subject when no body", () => {
		const c = commit("feat: add x", "");
		expect(getDescription(c)).toBe("add x");
	});
});

describe("isMergeCommit", () => {
	test("Merge branch 'x' into y → true", () => {
		expect(isMergeCommit(commit("Merge branch 'x' into y", ""))).toBe(true);
	});

	test("Merge pull request #1 from org/repo → true", () => {
		expect(isMergeCommit(commit("Merge pull request #1 from org/repo", ""))).toBe(true);
	});

	test("feat: add x → false", () => {
		expect(isMergeCommit(commit("feat: add x", ""))).toBe(false);
	});

	test("merge commit with leading space → true", () => {
		expect(isMergeCommit(commit("  Merge branch 'x'", ""))).toBe(true);
	});
});

describe("filterMergeCommits", () => {
	test("excludes merge commits, keeps semantic", () => {
		const commits = [
			commit("feat: add foo", ""),
			commit("Merge branch 'main' into ai/foo", ""),
			commit("fix: typo", ""),
		];
		const filtered = filterMergeCommits(commits);
		expect(filtered).toHaveLength(2);
		expect(filtered[0]?.subject).toBe("feat: add foo");
		expect(filtered[1]?.subject).toBe("fix: typo");
	});

	test("all merge commits → empty", () => {
		const commits = [commit("Merge branch 'x'", ""), commit("Merge pull request #1", "")];
		expect(filterMergeCommits(commits)).toEqual([]);
	});
});

describe("getChanges", () => {
	test("one bullet per commit", () => {
		const commits = [commit("feat: a", ""), commit("fix: b", "")];
		expect(getChanges(commits)).toEqual(["- feat: a", "- fix: b"]);
	});

	test("includes non-conventional commits", () => {
		const commits = [
			commit("feat: conventional", "", { type: "feat" }),
			commit("wip: messy commit message", ""),
		];
		expect(getChanges(commits)).toEqual(["- feat: conventional", "- wip: messy commit message"]);
	});

	test("empty commits returns empty", () => {
		expect(getChanges([])).toEqual([]);
	});
});

describe("isDocsOnly", () => {
	test("empty files → true", () => {
		expect(isDocsOnly([])).toBe(true);
	});

	test("only .md files → true", () => {
		expect(isDocsOnly(["README.md", "docs/a.md"])).toBe(true);
	});

	test("mixed files → false", () => {
		expect(isDocsOnly(["README.md", "src/foo.ts"])).toBe(false);
	});
});

describe("hasTestFiles", () => {
	test("no test files → false", () => {
		expect(hasTestFiles(["src/foo.ts"])).toBe(false);
	});

	test("test/ in path → true", () => {
		expect(hasTestFiles(["test/foo.test.ts"])).toBe(true);
	});

	test(".test.ts suffix → true", () => {
		expect(hasTestFiles(["foo.test.ts"])).toBe(true);
	});

	test(".spec.ts suffix → true", () => {
		expect(hasTestFiles(["foo.spec.ts"])).toBe(true);
	});

	test("spec/ in path → true", () => {
		expect(hasTestFiles(["spec/foo.spec.ts"])).toBe(true);
	});

	test("testament.ts not a test file → false", () => {
		expect(hasTestFiles(["src/testament.ts"])).toBe(false);
	});
});

describe("hasDocsFiles", () => {
	test("no docs → false", () => {
		expect(hasDocsFiles(["src/foo.ts"])).toBe(false);
	});

	test(".md file → true", () => {
		expect(hasDocsFiles(["README.md"])).toBe(true);
	});

	test("docs/ prefix → true", () => {
		expect(hasDocsFiles(["docs/guide.md"])).toBe(true);
	});
});

describe("isConventional", () => {
	test("feat: x → true", () => {
		expect(isConventional(commit("feat: add foo", "", { type: "feat" }))).toBe(true);
	});

	test("fix(scope): x → true", () => {
		expect(isConventional(commit("fix(api): handle error", "", { type: "fix" }))).toBe(true);
	});

	test("plain message → false", () => {
		expect(isConventional(commit("just some message", ""))).toBe(false);
	});
});

describe("getRelatedIssues", () => {
	test("extracts Closes #123", () => {
		const commits = [commit("x", "Closes #123", { references: ["Closes #123"] })];
		expect(getRelatedIssues(commits)).toEqual(["Closes #123"]);
	});

	test("extracts Fixes #456", () => {
		const commits = [commit("x", "Fixes #456", { references: ["Fixes #456"] })];
		expect(getRelatedIssues(commits)).toEqual(["Fixes #456"]);
	});

	test("extracts Resolves #789", () => {
		const commits = [commit("x", "Resolves #789", { references: ["Resolves #789"] })];
		expect(getRelatedIssues(commits)).toEqual(["Resolves #789"]);
	});

	test("deduplicates", () => {
		const commits = [
			commit("x", "Closes #1", { references: ["Closes #1"] }),
			commit("y", "Closes #1", { references: ["Closes #1"] }),
		];
		expect(getRelatedIssues(commits)).toEqual(["Closes #1"]);
	});
});

describe("getBreakingChanges", () => {
	test("no BREAKING CHANGE → none", () => {
		const commits = [commit("feat: x", "")];
		expect(getBreakingChanges(commits)).toEqual(Option.none());
	});

	test("BREAKING CHANGE in body → some", () => {
		const commits = [
			commit("feat: x", "BREAKING CHANGE: removed old API", {
				breakingNote: "removed old API",
			}),
		];
		expect(getBreakingChanges(commits)).toEqual(Option.some("removed old API"));
	});
});

describe("fillTemplate", () => {
	test("empty commits produces minimal data", () => {
		const data = fillTemplate([], []);
		expect(data.description).toBe("");
		expect(data.typeOfChange).toBe("Chore");
		expect(data.changes).toEqual(["- "]);
		expect(data.howToTest).toBe("N/A");
	});

	test("docs-only files → howToTest N/A", () => {
		const commits = [commit("docs: x", "")];
		const data = fillTemplate(commits, ["README.md"]);
		expect(data.howToTest).toBe("N/A");
	});

	test("code files → howToTest has steps", () => {
		const commits = [commit("feat: x", "")];
		const data = fillTemplate(commits, ["src/foo.ts"]);
		expect(data.howToTest).toContain("npm run check");
	});

	test("commitsConventional false when any commit is non-conventional", () => {
		const commits = [commit("feat: a", "", { type: "feat" }), commit("random message", "")];
		const data = fillTemplate(commits, []);
		expect(data.commitsConventional).toBe(false);
	});

	test("commitsConventional true when all commits are conventional", () => {
		const commits = [
			commit("feat: a", "", { type: "feat" }),
			commit("fix: b", "", { type: "fix" }),
		];
		const data = fillTemplate(commits, []);
		expect(data.commitsConventional).toBe(true);
	});
});

describe("renderBody", () => {
	test("returns rendered body when all placeholders replaced", async () => {
		const commits = [commit("feat: add x", "Description here", { type: "feat" })];
		const files = ["src/foo.ts"];
		const body = await Effect.runPromise(
			renderBody(commits, files, TEST_TEMPLATE).pipe(Effect.provide(SilentLoggerLayer)),
		);
		expect(body).toContain("## Description");
		expect(body).toContain("Description here");
		expect(body).not.toContain("{{description}}");
	});

	test("returns body and logs warning when output contains {{", async () => {
		const commits = [commit("feat: add x", "Use {{ and }} in your code", { type: "feat" })];
		const files = ["src/foo.ts"];
		const body = await Effect.runPromise(
			renderBody(commits, files, TEST_TEMPLATE).pipe(Effect.provide(SilentLoggerLayer)),
		);
		expect(body).toContain("Use {{ and }} in your code");
		expect(body).toContain("{{");
	});
});

describe("isValidConventionalTitle", () => {
	test("accepts valid conventional titles", () => {
		expect(isValidConventionalTitle("feat: add X")).toBe(true);
		expect(isValidConventionalTitle("fix(ci): resolve bug")).toBe(true);
		expect(isValidConventionalTitle("docs: update README")).toBe(true);
		expect(isValidConventionalTitle("feat!: breaking change")).toBe(true);
		expect(isValidConventionalTitle("feat(scope)!: breaking")).toBe(true);
	});

	test("rejects invalid titles", () => {
		expect(isValidConventionalTitle("")).toBe(false);
		expect(isValidConventionalTitle("Add feature X")).toBe(false);
		expect(isValidConventionalTitle("Here's the title: feat: add X")).toBe(false);
		expect(isValidConventionalTitle("  ")).toBe(false);
		expect(isValidConventionalTitle(`feat: ${"a".repeat(67)}`)).toBe(false);
		expect(isValidConventionalTitle(" : missing type")).toBe(false);
	});
});

describe("renderFromTemplate", () => {
	test("output contains all sections", () => {
		const data = fillTemplate(
			[commit("feat: add x", "Description here", { type: "feat" })],
			["src/foo.ts"],
		);
		const out = renderFromTemplate(TEST_TEMPLATE, data);
		expect(out).toContain("## Description");
		expect(out).toContain("## Type of change");
		expect(out).toContain("## Changes made");
		expect(out).toContain("## How to test");
		expect(out).toContain("## Checklist");
		expect(out).toContain("New feature");
		expect(out).toContain("Description here");
	});

	test("preserves literal {{ and }} in description", () => {
		const data = fillTemplate(
			[commit("feat: add x", "Use {{ and }} in your code", { type: "feat" })],
			["src/foo.ts"],
		);
		const out = renderFromTemplate(TEST_TEMPLATE, data);
		expect(out).toContain("Use {{ and }} in your code");
	});
});

// ─── runFillBody (file-based pipeline) tests ─────────────────────────────────

describe("runFillBody", () => {
	test("produces full PR body from log and files", async () => {
		const log = logContent({ subject: "feat: add foo", body: "This adds the foo module." });
		const output = await runWithLogAndFiles(log, "src/foo.ts\n");
		expect(output).toContain("## Description");
		expect(output).toContain("## Type of change");
		expect(output).toContain("## Changes made");
		expect(output).toContain("New feature");
		expect(output).toContain("feat: add foo");
		expect(output).toContain("This adds the foo module");
		expect(output).toContain("npm run check");
	});

	test("title-body format: first line is title (first commit subject)", async () => {
		const log = logContent({ subject: "feat(ci): add PR title generation", body: "" });
		const output = await runWithLogAndFiles(log, "src/ci.ts\n", {
			format: "title-body",
		});
		const lines = output.split("\n");
		expect(lines[0]).toBe("feat(ci): add PR title generation");
		expect(lines[1]).toBe("");
		expect(output).toContain("## Description");
	});

	test("multi-commit: body includes all commits, title from first (newest)", async () => {
		const log = logContent(
			{ subject: "feat: add module B", body: "" },
			{ subject: "feat: add module A", body: "" },
		);
		const output = await runWithLogAndFiles(log, "src/a.ts\nsrc/b.ts\n", {
			format: "title-body",
		});
		expect(output.split("\n")[0]).toBe("feat: add module B");
		expect(output).toContain("feat: add module A");
		expect(output).toContain("feat: add module B");
		expect(output).toContain("## Changes made");
	});

	test("filters merge commits, includes non-conventional", async () => {
		const log = logContent(
			{ subject: "feat: add foo", body: "" },
			{ subject: "Merge branch 'main' into ai/merge-test", body: "" },
			{ subject: "wip: messy commit", body: "" },
			{ subject: "feat: add y", body: "" },
		);
		const output = await runWithLogAndFiles(log, "src/foo.ts\nsrc/y.ts\n", {
			format: "title-body",
		});
		expect(output).toContain("feat: add foo");
		expect(output).toContain("wip: messy commit");
		expect(output).toContain("feat: add y");
		expect(output).not.toContain("Merge branch");
	});

	test("extracts Closes #42, docs-only → howToTest N/A", async () => {
		const log = logContent({ subject: "docs: update guide", body: "Closes #42" });
		const output = await runWithLogAndFiles(log, "docs/guide.md\n");
		expect(output).toContain("Closes #42");
		expect(output).toContain("Documentation update");
		expect(output).toContain("N/A");
	});

	test("uses custom template when path provided", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		const testLayer = NodeServices.layer.pipe(Layer.provideMerge(Logger.layer([])));
		try {
			const customTemplate = path.join(tmp.path, "custom.md");
			fs.writeFileSync(
				customTemplate,
				"Custom: {{description}}\nType: {{typeOfChange}}\n{{changes}}",
			);
			const log = logContent({ subject: "feat: add bar", body: "Bar feature here." });
			fs.writeFileSync(path.join(tmp.path, "commits.txt"), log);
			fs.writeFileSync(path.join(tmp.path, "files.txt"), "src/bar.ts\n");
			const output = await Effect.runPromise(
				runFillBody(
					path.join(tmp.path, "commits.txt"),
					path.join(tmp.path, "files.txt"),
					customTemplate,
				).pipe(Effect.provide(testLayer)),
			);
			expect(output).toContain("Custom: Bar feature here.");
			expect(output).toContain("Type: New feature");
			expect(output).toContain("feat: add bar");
		} finally {
			await tmp.remove();
		}
	});

	test("fails when log file not found", async () => {
		const tmp = await createTestTempDir("fill-pr-body-");
		const testLayer = NodeServices.layer.pipe(Layer.provideMerge(Logger.layer([])));
		try {
			fs.writeFileSync(path.join(tmp.path, "files.txt"), "src/foo.ts\n");
			const program = runFillBody(
				path.join(tmp.path, "nonexistent.txt"),
				path.join(tmp.path, "files.txt"),
				undefined,
			).pipe(Effect.provide(testLayer));
			await expect(Effect.runPromise(program)).rejects.toThrow("Log file not found");
		} finally {
			await tmp.remove();
		}
	});

	test("fails when no commits (empty title in title-body format)", async () => {
		const output = runWithLogAndFiles("", "", { format: "title-body" });
		await expect(output).rejects.toThrow("PR title is empty. Add at least one non-merge commit");
	});
});

describe("--validate-title CLI", () => {
	const runValidateTitle = (title: string): number => {
		const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
		// Use --flag=value form to avoid CLI parsing ambiguity (e.g. "Add feature X" as separate args)
		const result = childProcess.spawnSync(
			"npx",
			["tsx", "scripts/fill-pr-body.ts", `--validate-title=${title}`],
			{ cwd: root, encoding: "utf8" },
		);
		return result.status ?? -1;
	};

	test("valid conventional title exits 0", () => {
		expect(runValidateTitle("feat: add X")).toBe(0);
		expect(runValidateTitle("fix(ci): resolve bug")).toBe(0);
	});

	test("invalid title exits 1", () => {
		expect(runValidateTitle("Add feature X")).toBe(1);
		expect(runValidateTitle("")).toBe(1);
		expect(runValidateTitle("  ")).toBe(1);
	});
});
