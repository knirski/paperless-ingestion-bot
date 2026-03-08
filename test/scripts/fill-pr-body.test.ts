import { Effect, Option, Result } from "effect";
import { describe, expect, test } from "vitest";
import {
	fetchCommitsAndFiles,
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
	parseOllamaJson,
	renderBody,
	renderFromTemplate,
} from "../../scripts/fill-pr-body.js";
import type { GitClientService } from "../../scripts/git-client.js";
import { SilentLoggerLayer } from "../test-utils.js";

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

function createMockGit(behavior: {
	readonly log: (base: string) => Effect.Effect<string, Error>;
	readonly diffNames: (base: string) => Effect.Effect<readonly string[], never>;
}): GitClientService {
	return {
		...behavior,
		defaultBranch: () => Effect.succeed("main"),
		repoRoot: () => Effect.succeed("/tmp"),
	};
}

describe("fetchCommitsAndFiles", () => {
	test("succeeds when base works directly", async () => {
		const mock = createMockGit({
			log: () => Effect.succeed("---COMMIT---\nfeat: x"),
			diffNames: () => Effect.succeed(["a.ts"]),
		});
		const [logOut, files] = await Effect.runPromise(
			fetchCommitsAndFiles(mock, "main").pipe(Effect.provide(SilentLoggerLayer)),
		);
		expect(logOut).toBe("---COMMIT---\nfeat: x");
		expect(files).toEqual(["a.ts"]);
	});

	test("falls back to origin/main when main fails", async () => {
		const mock = createMockGit({
			log: (base) =>
				base === "origin/main"
					? Effect.succeed("---COMMIT---\nfeat: y")
					: Effect.fail(new Error("ref not found")),
			diffNames: (base) => (base === "origin/main" ? Effect.succeed(["b.ts"]) : Effect.succeed([])),
		});
		const [logOut, files] = await Effect.runPromise(
			fetchCommitsAndFiles(mock, "main").pipe(Effect.provide(SilentLoggerLayer)),
		);
		expect(logOut).toBe("---COMMIT---\nfeat: y");
		expect(files).toEqual(["b.ts"]);
	});

	test("falls back to origin/feature/foo when feature/foo fails", async () => {
		const mock = createMockGit({
			log: (base) =>
				base === "origin/feature/foo"
					? Effect.succeed("---COMMIT---\nfeat: qux")
					: Effect.fail(new Error("ref not found")),
			diffNames: (base) =>
				base === "origin/feature/foo" ? Effect.succeed(["qux.ts"]) : Effect.succeed([]),
		});
		const [logOut, files] = await Effect.runPromise(
			fetchCommitsAndFiles(mock, "feature/foo").pipe(Effect.provide(SilentLoggerLayer)),
		);
		expect(logOut).toBe("---COMMIT---\nfeat: qux");
		expect(files).toEqual(["qux.ts"]);
	});

	test("fails with clear message when both base and origin/base fail", async () => {
		const mock = createMockGit({
			log: () => Effect.fail(new Error("ref not found")),
			diffNames: () => Effect.succeed([]),
		});
		await expect(
			Effect.runPromise(fetchCommitsAndFiles(mock, "main").pipe(Effect.provide(SilentLoggerLayer))),
		).rejects.toThrow("Tried origin/main");
		await expect(
			Effect.runPromise(fetchCommitsAndFiles(mock, "main").pipe(Effect.provide(SilentLoggerLayer))),
		).rejects.toThrow('Base branch "main" not found');
	});

	test("fails without retry when base is already origin/qualified", async () => {
		const mock = createMockGit({
			log: () => Effect.fail(new Error("ref not found")),
			diffNames: () => Effect.succeed([]),
		});
		const err = await Effect.runPromise(
			fetchCommitsAndFiles(mock, "origin/main").pipe(
				Effect.provide(SilentLoggerLayer),
				Effect.flip,
			),
		);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toContain("ref not found");
		expect((err as Error).message).not.toContain("Tried origin/main");
	});
});

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
	test("uses body when not Closes/Fixes", () => {
		const c = commit("feat: add x", "This adds the x feature.\nMore details.");
		expect(getDescription(c)).toBe("This adds the x feature.\nMore details.");
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
			commit("wip: messy commit message", ""), // no type → non-conventional
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

describe("parseOllamaJson", () => {
	test("returns first line from response", async () => {
		const res = new Response(JSON.stringify({ response: "feat: add X" }));
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBe("feat: add X");
	});

	test("returns first line only when multi-line", async () => {
		const res = new Response(JSON.stringify({ response: "feat: add X\n\nMore text" }));
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBe("feat: add X");
	});

	test("truncates to 72 chars", async () => {
		const long = "a".repeat(80);
		const res = new Response(JSON.stringify({ response: long }));
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBe("a".repeat(72));
	});

	test("returns undefined for empty response", async () => {
		const res = new Response(JSON.stringify({ response: "" }));
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBeUndefined();
	});

	test("returns undefined for missing response field", async () => {
		const res = new Response(JSON.stringify({}));
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBeUndefined();
	});

	test("returns undefined for invalid JSON", async () => {
		const res = new Response("not json");
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBeUndefined();
	});

	test("trims whitespace", async () => {
		const res = new Response(JSON.stringify({ response: "  feat: add X  " }));
		const out = await Effect.runPromise(parseOllamaJson(res));
		expect(out).toBe("feat: add X");
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
		expect(isValidConventionalTitle(`feat: ${"a".repeat(67)}`)).toBe(false); // 73 chars
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
