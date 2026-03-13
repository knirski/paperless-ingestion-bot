import { Result } from "effect";
import { describe, expect, test } from "vitest";
import {
	buildDescriptionPrompt,
	buildTitlePrompt,
	filterSemanticSubjects,
	firstLine,
	formatGhOutput,
	isBlank,
	isMergeCommitSubject,
	parseSubjects,
	sanitizeForGhOutput,
	trimOllamaResponse,
	validateDescriptionResponse,
	validateTitleResponse,
} from "../../../scripts/auto-pr/index.js";
import { isValidConventionalTitle } from "../../../scripts/fill-pr-template.js";

describe("auto-pr core", () => {
	describe("isMergeCommitSubject", () => {
		test("matches merge commit", () => {
			expect(isMergeCommitSubject("Merge branch 'main' into feature")).toBe(true);
			expect(isMergeCommitSubject("merge pull request #1")).toBe(true);
		});
		test("rejects non-merge", () => {
			expect(isMergeCommitSubject("feat: add foo")).toBe(false);
			expect(isMergeCommitSubject("fix: bar")).toBe(false);
		});
	});

	describe("filterSemanticSubjects", () => {
		test("filters merge and blank", () => {
			const input = ["feat: a", "Merge branch 'x'", "", "  ", "fix: b"];
			expect(filterSemanticSubjects(input)).toEqual(["feat: a", "fix: b"]);
		});
		test("returns empty for all merge/blank", () => {
			expect(filterSemanticSubjects(["Merge x", "", "  "])).toEqual([]);
		});
	});

	describe("formatGhOutput", () => {
		test("formats key=value lines with trailing newline", () => {
			const entries = [
				{ key: "a", value: "1" },
				{ key: "b", value: "2" },
			];
			expect(formatGhOutput(entries)).toBe("a=1\nb=2\n");
		});
	});

	describe("sanitizeForGhOutput", () => {
		test("escapes percent, CR, newline", () => {
			expect(sanitizeForGhOutput("a%b\nc\rd")).toBe("a%25b%0Ac%0Dd");
		});
		test("trims and slices to 72", () => {
			expect(sanitizeForGhOutput("  x  ")).toBe("x");
			expect(sanitizeForGhOutput("a".repeat(100)).length).toBe(72);
		});
	});

	describe("isBlank", () => {
		test("true for empty and whitespace", () => {
			expect(isBlank("")).toBe(true);
			expect(isBlank("   ")).toBe(true);
			expect(isBlank("\t\n")).toBe(true);
		});
		test("false for content", () => {
			expect(isBlank("x")).toBe(false);
			expect(isBlank("  x  ")).toBe(false);
		});
	});

	describe("firstLine", () => {
		test("returns first line trimmed", () => {
			expect(firstLine("a\nb\nc")).toBe("a");
			expect(firstLine("  x  \ny")).toBe("x");
		});
		test("returns empty for empty", () => {
			expect(firstLine("")).toBe("");
		});
	});

	describe("parseSubjects", () => {
		test("splits and filters", () => {
			expect(parseSubjects("a\n\nb\n  c  ")).toEqual(["a", "b", "c"]);
		});
	});

	describe("trimOllamaResponse", () => {
		test("trims quotes and whitespace", () => {
			expect(trimOllamaResponse('"hello"')).toBe("hello");
			expect(trimOllamaResponse("  x  ")).toBe("x");
		});
	});

	describe("buildTitlePrompt", () => {
		test("builds prompt with subjects", () => {
			const out = buildTitlePrompt("Title template", ["a", "b"]);
			expect(out).toContain("Title template");
			expect(out).toContain("- a");
			expect(out).toContain("- b");
		});
	});

	describe("buildDescriptionPrompt", () => {
		test("builds prompt with content", () => {
			const out = buildDescriptionPrompt("Desc template", "commit content");
			expect(out).toContain("Desc template");
			expect(out).toContain("commit content");
		});
	});

	describe("validateTitleResponse", () => {
		test("succeeds for valid conventional", () => {
			Result.match(validateTitleResponse("feat: add x", isValidConventionalTitle), {
				onSuccess: (v) => expect(v).toBe("feat: add x"),
				onFailure: () => expect.fail("expected success"),
			});
		});
		test("fails for empty", () => {
			Result.match(validateTitleResponse("", isValidConventionalTitle), {
				onSuccess: () => expect.fail("expected failure"),
				onFailure: () => {},
			});
		});
		test("fails for 'null' string (Ollama fallback)", () => {
			Result.match(validateTitleResponse("null", isValidConventionalTitle), {
				onSuccess: () => expect.fail("expected failure"),
				onFailure: () => {},
			});
		});
		test("fails for invalid format", () => {
			Result.match(validateTitleResponse("not conventional", isValidConventionalTitle), {
				onSuccess: () => expect.fail("expected failure"),
				onFailure: () => {},
			});
		});
	});

	describe("validateDescriptionResponse", () => {
		test("succeeds for non-empty", () => {
			Result.match(validateDescriptionResponse("some text"), {
				onSuccess: (v) => expect(v).toBe("some text"),
				onFailure: () => expect.fail("expected success"),
			});
		});
		test("fails for empty", () => {
			Result.match(validateDescriptionResponse(""), {
				onSuccess: () => expect.fail("expected failure"),
				onFailure: () => {},
			});
			Result.match(validateDescriptionResponse("null"), {
				onSuccess: () => expect.fail("expected failure"),
				onFailure: () => {},
			});
		});
	});
});
