/**
 * Pure core for auto-PR scripts. No Effect, no I/O.
 * Shared by auto-pr-get-commits, auto-pr-ollama, create-or-update-pr.
 */

import type { Result } from "effect";
import { Result as ResultModule } from "effect";

/** Merge commits (e.g. "Merge branch 'x' into y") add no semantic value. Keep in sync with fill-pr-template isMergeCommit. */
export function isMergeCommitSubject(subject: string): boolean {
	return /^Merge /i.test(subject.trim());
}

/** Filter out merge commits and blank lines from subject list. */
export function filterSemanticSubjects(subjects: string[]): string[] {
	return subjects
		.map((s) => s.trim())
		.filter((line) => line.length > 0 && !isMergeCommitSubject(line));
}

/** Format GITHUB_OUTPUT entries as key=value lines. */
export function formatGhOutput(entries: ReadonlyArray<{ key: string; value: string }>): string {
	return `${entries.map((e) => `${e.key}=${e.value}`).join("\n")}\n`;
}

/** Escape value for GitHub Actions output (multiline, percent, CR). */
export function sanitizeForGhOutput(s: string): string {
	const trimmed = s.trim().slice(0, 72);
	return trimmed.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Check if string is empty or whitespace-only. */
export function isBlank(s: string): boolean {
	return s.trim().length === 0;
}

/** Extract first line from content. */
export function firstLine(content: string): string {
	return content.split("\n")[0]?.trim() ?? "";
}

/** Parse newline-separated subjects from file content. */
export function parseSubjects(content: string): string[] {
	return content
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Trim quotes and surrounding whitespace from Ollama response. */
export function trimOllamaResponse(s: string): string {
	return s.replace(/^"|"$/g, "").replace(/^\s+|\s+$/g, "");
}

/** Build full title prompt from template and subjects. */
export function buildTitlePrompt(promptTemplate: string, subjects: string[]): string {
	const list = subjects.map((s) => `- ${s}`).join("\n");
	return `${promptTemplate.trim()}\n\nCommits:\n${list}`;
}

/** Build full description prompt from template and commit content. */
export function buildDescriptionPrompt(promptTemplate: string, commitContent: string): string {
	return `${promptTemplate.trim()}\n\nCommits:\n${commitContent}`;
}

/** Validate title response: non-empty, not "null", conventional format. */
export function validateTitleResponse(
	raw: string,
	isValidConventionalTitle: (s: string) => boolean,
): Result.Result<string, Error> {
	const t = firstLine(trimOllamaResponse(raw));
	if (!t || t === "null") return ResultModule.fail(new Error("invalid or empty"));
	if (!isValidConventionalTitle(t))
		return ResultModule.fail(new Error("invalid conventional title"));
	return ResultModule.succeed(t);
}

/** Validate description response: non-empty, not "null". */
export function validateDescriptionResponse(raw: string): Result.Result<string, Error> {
	const t = trimOllamaResponse(raw);
	if (!t || t === "null") return ResultModule.fail(new Error("empty"));
	return ResultModule.succeed(t);
}
