/**
 * Fill PR template from conventional commit messages.
 * Pure core + Effect shell. Run: npx tsx scripts/fill-pr-template.ts --log-file <path> --files-file <path>
 *
 * Reads .github/PULL_REQUEST_TEMPLATE.md (or --template path), replaces
 * {{placeholder}} values, outputs to stdout. See docs/PR_TEMPLATE.md for
 * how this template works for both manual and automated PRs.
 *
 * Requires --log-file and --files-file (commit log and changed files). The workflow
 * or create-or-update-pr.ts generates these via git before invoking this script.
 */

import * as path from "node:path";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { Commit } from "conventional-commits-parser";
import { CommitParser } from "conventional-commits-parser";
import { Console, Effect, FileSystem, Layer, Logger, Option, pipe, Result } from "effect";
import * as Arr from "effect/Array";
import { Command, Flag } from "effect/unstable/cli";
import pkg from "../package.json" with { type: "json" };
import { formatAutoPrError, ParseError, PrTitleBlank } from "./auto-pr/index.js";

export { ParseError };

import type { FileSystemError } from "../src/domain/errors.js";
import { redactPath } from "../src/domain/utils.js";
import { mapFsError } from "../src/shell/fs-utils.js";
import { collapseProseParagraphs } from "./collapse-prose-paragraphs.js";

// ─── Types ─────────────────────────────────────────────────────────────────

interface CommitInfo {
	readonly subject: string;
	readonly body: string;
	readonly fullMessage: string;
	readonly type: string | null;
	readonly references: readonly string[];
	readonly breakingNote: string | null;
}

interface TemplateData {
	readonly description: string;
	readonly typeOfChange: TypeOfChange;
	readonly changes: readonly string[];
	readonly howToTest: string;
	readonly commitsConventional: boolean;
	readonly docsUpdated: boolean;
	readonly testsAdded: boolean;
	readonly relatedIssues: readonly string[];
	readonly breakingChanges: string;
}

const TYPE_OF_CHANGE = [
	"Bug fix",
	"Security fix",
	"Breaking change",
	"Chore",
	"Documentation update",
	"New feature",
] as const;
type TypeOfChange = (typeof TYPE_OF_CHANGE)[number];

/** Conventional commit types we map to TypeOfChange. */
const CONVENTIONAL_TYPES = [
	"feat",
	"fix",
	"docs",
	"security",
	"chore",
	"ci",
	"build",
	"refactor",
	"style",
	"test",
	"perf",
	"revert",
] as const;
type ConventionalType = (typeof CONVENTIONAL_TYPES)[number];

// ─── Pure core ─────────────────────────────────────────────────────────────

const ISSUE_STARTS_PATTERN = /^(Closes|Fixes|Fix|Resolves|Resolve|Closed|Close) #\d+/i;

const TYPE_MAP: Record<ConventionalType, TypeOfChange> = {
	feat: "New feature",
	fix: "Bug fix",
	docs: "Documentation update",
	security: "Security fix",
	chore: "Chore",
	ci: "Chore",
	build: "Chore",
	refactor: "Chore",
	style: "Chore",
	test: "Chore",
	perf: "Chore",
	revert: "Chore",
};

function isConventionalType(s: string): s is ConventionalType {
	return CONVENTIONAL_TYPES.some((t) => t === s);
}

function typeFromString(s: string | null | undefined): TypeOfChange {
	if (!s) return "Chore";
	const lower = s.toLowerCase();
	return isConventionalType(lower) ? TYPE_MAP[lower] : "Chore";
}

const parser = new CommitParser();

function mapParsedToCommitInfo(block: string, parsed: Commit): CommitInfo {
	const header = parsed.header ?? block.split("\n")[0] ?? "";
	const bodyParts = [parsed.body, parsed.footer].filter(Boolean);
	const body = bodyParts.join("\n\n").trim();
	const refs = parsed.references.map((r) => {
		const action = r.action ?? "Closes";
		const ref =
			r.owner != null && r.repository != null
				? `${r.owner}/${r.repository}#${r.issue}`
				: `${r.prefix ?? "#"}${r.issue}`;
		return `${action} ${ref}`;
	});
	const breaking = parsed.notes.find((n) => /BREAKING/i.test(n.title));
	return {
		subject: header,
		body,
		fullMessage: block,
		type: parsed.type ?? null,
		references: refs,
		breakingNote: breaking?.text ?? null,
	};
}

export function parseCommits(logOutput: string): Result.Result<readonly CommitInfo[], ParseError> {
	return Result.try({
		try: () => {
			const blocks = logOutput
				.split("---COMMIT---")
				.map((b) => b.trim())
				.filter(Boolean);
			return blocks.map((block) => mapParsedToCommitInfo(block, parser.parse(block)));
		},
		catch: (e) =>
			new ParseError({
				message: "Failed to parse commits",
				cause: e instanceof Error ? e : new Error(String(e)),
			}),
	});
}

export function inferTypeOfChange(commits: readonly CommitInfo[]): TypeOfChange {
	const hasBreaking = commits.some((c) => c.breakingNote != null);
	if (hasBreaking) return "Breaking change";
	const first = commits[0];
	if (!first) return "Chore";
	const sub = first.subject;
	if (/^feat!|^feat\(.*\)!:|^BREAKING/.test(sub)) return "Breaking change";

	const fromType = typeFromString(first.type);
	if (fromType !== "Chore") return fromType;
	const prefix = sub.toLowerCase().split(":")[0] ?? "";
	return typeFromString(prefix);
}

function getTitle(commits: readonly CommitInfo[]): string {
	const first = commits[0];
	return first?.subject ?? "";
}

/** Conventional commit header: type(scope)?!?: subject. Explicit regex to avoid parser fallback behavior. */
const CONVENTIONAL_HEADER_PATTERN = /^(\w+)(?:\([^)]*\))?!?: .+$/;

export function isValidConventionalTitle(s: string): boolean {
	const trimmed = s.trim();
	if (trimmed.length === 0 || trimmed.length > 72) return false;
	return CONVENTIONAL_HEADER_PATTERN.test(trimmed);
}

export function getDescription(first: CommitInfo): string {
	const body = first.body.trim();
	const firstLine = body.split("\n")[0] ?? "";
	if (body && !ISSUE_STARTS_PATTERN.test(firstLine)) {
		const raw = body.split("\n").slice(0, 20).join("\n");
		return collapseProseParagraphs(raw);
	}
	const match = /^[^:]+:\s*(.+)$/.exec(first.subject);
	const captured = match?.[1];
	return captured != null ? captured.trim() : first.subject;
}

/** Concatenate all commit bodies/subjects into one description. Uses getDescription per commit, joins with blank lines. Fallback when Ollama is not used. */
export function getDescriptionFromCommits(commits: readonly CommitInfo[]): string {
	const parts = commits.map((c) => getDescription(c)).filter(Boolean);
	return parts.join("\n\n");
}

/** Output text for Ollama to summarize into PR description. One block per commit: subject + body. */
export function getDescriptionPromptText(commits: readonly CommitInfo[]): string {
	return commits
		.map((c) => {
			const block = c.body.trim() ? `${c.subject}\n\n${c.body}` : c.subject;
			return `- ${block}`;
		})
		.join("\n\n");
}

export function getChanges(commits: readonly CommitInfo[]): readonly string[] {
	return commits.filter((c) => c.subject).map((c) => `- ${c.subject}`);
}

export function isDocsOnly(files: readonly string[]): boolean {
	if (files.length === 0) return true;
	return files.every((f) => f.endsWith(".md") || f.startsWith("docs/"));
}

export function hasTestFiles(files: readonly string[]): boolean {
	return files.some(
		(f) =>
			f.endsWith(".test.ts") || f.endsWith(".spec.ts") || /\/test\//.test(f) || /\/spec\//.test(f),
	);
}

export function hasDocsFiles(files: readonly string[]): boolean {
	return files.some((f) => f.endsWith(".md") || f.startsWith("docs/"));
}

export function isConventional(commit: CommitInfo): boolean {
	return commit.type != null;
}

/** Merge commits (e.g. "Merge branch 'x' into y") add no semantic value for PR body/title. */
export function isMergeCommit(c: CommitInfo): boolean {
	return /^Merge /i.test(c.subject.trim());
}

/** Exclude merge commits; keep only semantic commits for body and title. */
export function filterMergeCommits(commits: readonly CommitInfo[]): readonly CommitInfo[] {
	return commits.filter((c) => !isMergeCommit(c));
}

export function getRelatedIssues(commits: readonly CommitInfo[]): readonly string[] {
	return pipe(
		commits,
		(commits) => commits.flatMap((c) => c.references),
		(refs) => [...new Set(refs)].toSorted(),
	);
}

export function getBreakingChanges(commits: readonly CommitInfo[]): Option.Option<string> {
	return pipe(
		Arr.findFirst(
			commits,
			(c): c is CommitInfo & { breakingNote: string } => c.breakingNote != null,
		),
		Option.map((c) => c.breakingNote.trim().slice(0, 2000)),
	);
}

export function fillTemplate(
	commits: readonly CommitInfo[],
	files: readonly string[],
	descriptionOverride?: string,
): TemplateData {
	const typeOfChange = inferTypeOfChange(commits);
	const description =
		descriptionOverride !== undefined && descriptionOverride !== ""
			? descriptionOverride
			: getDescriptionFromCommits(commits);
	const changes = commits.length ? getChanges(commits) : ["- "];
	const howToTest = isDocsOnly(files) ? "N/A" : "1. Run `npm run check`\n2. ";
	const breaking = pipe(
		getBreakingChanges(commits),
		Option.getOrElse(() => ""),
	);

	return {
		description,
		typeOfChange,
		changes,
		howToTest,
		commitsConventional: commits.length > 0 && commits.every(isConventional),
		docsUpdated: hasDocsFiles(files),
		testsAdded: hasTestFiles(files),
		relatedIssues: getRelatedIssues(commits),
		breakingChanges: typeOfChange === "Breaking change" ? breaking : "",
	};
}

const PLACEHOLDERS = [
	"description",
	"typeOfChange",
	"changes",
	"howToTest",
	"checklistConventional",
	"checklistDocs",
	"checklistTests",
	"relatedIssues",
	"breakingChanges",
	"placeholder", // Template comment "Replace each {{placeholder}} below"
] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

type SubstitutionMap = Record<Placeholder, string>;

function buildSubstitutionMap(data: TemplateData): SubstitutionMap {
	const conv = data.commitsConventional ? "x" : " ";
	const docs = data.docsUpdated ? "x" : " ";
	const tests = data.testsAdded ? "x" : " ";
	return {
		description: data.description,
		typeOfChange: data.typeOfChange,
		changes: data.changes.length ? data.changes.join("\n") : "- ",
		howToTest: data.howToTest,
		checklistConventional: conv,
		checklistDocs: docs,
		checklistTests: tests,
		relatedIssues: data.relatedIssues.length ? data.relatedIssues.join("\n") : "",
		breakingChanges: data.breakingChanges || "",
		placeholder: "placeholder",
	};
}

/** Sentinel chars to escape literal {{ and }} in values so they aren't substituted. */
const ESCAPE_OPEN = "\uE000";
const ESCAPE_CLOSE = "\uE001";

function escapeForSubstitution(s: string): string {
	return s.replaceAll("{{", ESCAPE_OPEN).replaceAll("}}", ESCAPE_CLOSE);
}

function unescapeAfterSubstitution(s: string): string {
	return s.replaceAll(ESCAPE_OPEN, "{{").replaceAll(ESCAPE_CLOSE, "}}");
}

/** Substitute {{placeholder}} in template with values from data. Values are escaped so literal {{ and }} in commit content are preserved. */
export function renderFromTemplate(template: string, data: TemplateData): string {
	const map = buildSubstitutionMap(data);
	const substituted = PLACEHOLDERS.reduce((out, key) => {
		const value = map[key];
		const escaped = escapeForSubstitution(value);
		return out.replaceAll(`{{${key}}}`, escaped);
	}, template);
	return unescapeAfterSubstitution(substituted);
}

// ─── Shell (Effect) ────────────────────────────────────────────────────────

function readTemplate(
	filePath: string,
): Effect.Effect<string, FileSystemError, FileSystem.FileSystem> {
	return pipe(
		FileSystem.FileSystem.asEffect(),
		Effect.flatMap((fs) =>
			fs.readFileString(filePath).pipe(mapFsError(filePath, "readFileString")),
		),
	);
}

type OutputFormat = "body" | "title-body";

function resolveTemplatePath(templatePath: string | undefined): string {
	const cwd = process.cwd();
	return templatePath
		? path.isAbsolute(templatePath)
			? templatePath
			: path.resolve(cwd, templatePath)
		: path.resolve(cwd, ".github/PULL_REQUEST_TEMPLATE.md");
}

function readLogAndFiles(
	logFilePath: string,
	filesFilePath: string,
): Effect.Effect<readonly [string, readonly string[]], FileSystemError, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem.asEffect();
		const [logContent, filesContent] = yield* Effect.all([
			fs.readFileString(logFilePath).pipe(mapFsError(logFilePath, "readFileString")),
			fs.readFileString(filesFilePath).pipe(mapFsError(filesFilePath, "readFileString")),
		]);
		const files = filesContent
			.split("\n")
			.map((f) => f.trim())
			.filter(Boolean);
		return [logContent, files] as const;
	});
}

export function renderBody(
	commits: readonly CommitInfo[],
	files: readonly string[],
	template: string,
	descriptionOverride?: string,
): Effect.Effect<string> {
	const data = fillTemplate(commits, files, descriptionOverride);
	const body = renderFromTemplate(template, data);
	return body.includes("{{")
		? Effect.gen(function* () {
				yield* Effect.logWarning({
					event: "fill_pr_template",
					message: "Output contains unreplaced {{placeholder}}s",
				});
				return body;
			})
		: Effect.succeed(body);
}

export function runFillBody(
	logFilePath: string,
	filesFilePath: string,
	templatePath: string | undefined,
	format: OutputFormat = "body",
	descriptionFilePath?: string,
): Effect.Effect<string, ParseError | FileSystemError | PrTitleBlank, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const resolvedTemplatePath = resolveTemplatePath(templatePath);

		yield* Effect.log({
			event: "fill_pr_template",
			status: "started",
			logFile: redactPath(logFilePath),
			filesFile: redactPath(filesFilePath),
			templatePath: redactPath(resolvedTemplatePath),
			format,
			descriptionFile: descriptionFilePath ? redactPath(descriptionFilePath) : undefined,
		});

		const template = yield* readTemplate(resolvedTemplatePath);
		const [logContent, files] = yield* readLogAndFiles(logFilePath, filesFilePath);
		const parseResult = parseCommits(logContent);
		const rawCommits = yield* Effect.fromResult(parseResult);
		const commits = filterMergeCommits(rawCommits);

		let descriptionOverride: string | undefined;
		if (descriptionFilePath) {
			const fs = yield* FileSystem.FileSystem.asEffect();
			descriptionOverride = yield* fs
				.readFileString(descriptionFilePath)
				.pipe(mapFsError(descriptionFilePath, "readFileString"));
		}

		const body = yield* renderBody(commits, files, template, descriptionOverride);
		const title = getTitle(commits);

		if (format === "title-body" && !title.trim()) {
			return yield* Effect.fail(
				new PrTitleBlank({
					message:
						"PR title is empty. Add at least one non-merge commit with non-empty subject (e.g. feat: add X) before pushing.",
				}),
			);
		}

		const result = format === "title-body" ? `${title}\n\n${body}` : body;

		yield* Effect.log({
			event: "fill_pr_template",
			status: "succeeded",
			commitsCount: commits.length,
			filesCount: files.length,
		});
		return result;
	});
}

const logFileFlag = Flag.string("log-file").pipe(
	Flag.optional,
	Flag.withDescription("Path to file containing commit log (---COMMIT--- separated blocks)."),
);

const filesFileFlag = Flag.string("files-file").pipe(
	Flag.optional,
	Flag.withDescription("Path to file containing newline-separated changed file names."),
);

const templateFlag = Flag.string("template").pipe(
	Flag.optional,
	Flag.withDescription("Path to template file (default: .github/PULL_REQUEST_TEMPLATE.md)"),
);

const formatFlag = Flag.string("format").pipe(
	Flag.optional,
	Flag.withDescription("Output format: 'body' (default) or 'title-body' (first line = PR title)."),
);

const quietFlag = Flag.boolean("quiet").pipe(
	Flag.withDefault(false),
	Flag.withDescription("Suppress logs (for CI when capturing stdout)."),
);

const validateTitleFlag = Flag.string("validate-title").pipe(
	Flag.optional,
	Flag.withDescription(
		"Validate conventional commit title; exit 0 if valid, 1 otherwise. Skips fill when used.",
	),
);

const outputDescriptionPromptFlag = Flag.boolean("output-description-prompt").pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		"Output commit content for Ollama to summarize into PR description. Requires --log-file only. Exits after output.",
	),
);

const descriptionFileFlag = Flag.string("description-file").pipe(
	Flag.optional,
	Flag.withDescription(
		"Path to file containing Ollama-generated description. Overrides computed description.",
	),
);

const fillCommand = Command.make(
	"fill-pr-template",
	{
		logFile: logFileFlag,
		filesFile: filesFileFlag,
		template: templateFlag,
		format: formatFlag,
		quiet: quietFlag,
		validateTitle: validateTitleFlag,
		outputDescriptionPrompt: outputDescriptionPromptFlag,
		descriptionFile: descriptionFileFlag,
	},
	({
		logFile,
		filesFile,
		template,
		format,
		quiet,
		validateTitle,
		outputDescriptionPrompt,
		descriptionFile,
	}) => {
		const titleToValidate = Option.getOrUndefined(validateTitle);
		if (titleToValidate !== undefined) {
			const valid = isValidConventionalTitle(titleToValidate);
			return Effect.sync(() => {
				process.exit(valid ? 0 : 1);
			});
		}
		const logFilePath = Option.getOrUndefined(logFile);
		const filesFilePath = Option.getOrUndefined(filesFile);

		if (outputDescriptionPrompt) {
			if (!logFilePath) {
				return Effect.fail(new Error("--output-description-prompt requires --log-file."));
			}
			const loggerLayer = quiet
				? Logger.layer([])
				: Logger.layer([Logger.consolePretty({ colors: process.env.NO_COLOR === undefined })]).pipe(
						Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
					);
			const layer = NodeServices.layer.pipe(Layer.provideMerge(loggerLayer));
			return Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem.asEffect();
				const logContent = yield* fs
					.readFileString(logFilePath)
					.pipe(mapFsError(logFilePath, "readFileString"));
				const parseResult = parseCommits(logContent);
				const rawCommits = yield* Effect.fromResult(parseResult);
				const commits = filterMergeCommits(rawCommits);
				return getDescriptionPromptText(commits);
			}).pipe(Effect.provide(layer), Effect.flatMap(Console.log));
		}

		if (!logFilePath || !filesFilePath) {
			return Effect.fail(
				new Error(
					"--log-file and --files-file are required. Generate them via git before invoking.",
				),
			);
		}
		const formatVal = Option.getOrUndefined(format) === "title-body" ? "title-body" : "body";
		const loggerLayer = quiet
			? Logger.layer([])
			: Logger.layer([Logger.consolePretty({ colors: process.env.NO_COLOR === undefined })]).pipe(
					Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
				);
		const layer = NodeServices.layer.pipe(Layer.provideMerge(loggerLayer));
		return runFillBody(
			logFilePath,
			filesFilePath,
			Option.getOrUndefined(template),
			formatVal,
			Option.getOrUndefined(descriptionFile),
		).pipe(Effect.provide(layer), Effect.flatMap(Console.log));
	},
);

const cliProgram = Command.run(fillCommand, { version: pkg.version });

/** Respect NO_COLOR (https://no-color.org): disable colors when set, for CI/scripting. */
const LoggerLayer = Logger.layer([
	Logger.consolePretty({ colors: process.env.NO_COLOR === undefined }),
]).pipe(Layer.provide(Layer.succeed(Logger.LogToStderr)(true)));

/** CLI services: NodeServices + Logger. */
const CliLayer = NodeServices.layer.pipe(Layer.provideMerge(LoggerLayer));

// ─── Entry ─────────────────────────────────────────────────────────────────

if (import.meta.main) {
	NodeRuntime.runMain(
		cliProgram.pipe(
			Effect.provide(CliLayer),
			Effect.tapError((e) =>
				Effect.logError({
					event: "fill_pr_template_failed",
					error: formatAutoPrError(e),
					...(e instanceof Error && e.stack ? { stack: e.stack } : {}),
				}),
			),
		),
	);
}
