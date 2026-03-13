/**
 * Fill PR template from conventional commit messages.
 * Pure core + Effect shell. Run: npx tsx scripts/fill-pr-body.ts --log-file <path> --files-file <path>
 *
 * Reads .github/PULL_REQUEST_TEMPLATE.md (or --template path), replaces
 * {{placeholder}} values, outputs to stdout. See docs/PR_TEMPLATE.md for
 * how this template works for both manual and automated PRs.
 *
 * Requires --log-file and --files-file (commit log and changed files). The workflow
 * or create-or-update-pr.sh generates these via git before invoking this script.
 */

import * as path from "node:path";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommitParser } from "conventional-commits-parser";
import { Console, Effect, FileSystem, Layer, Logger, Option, pipe, Result } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import pkg from "../package.json" with { type: "json" };

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
	"Breaking change",
	"Chore",
	"Documentation update",
	"New feature",
] as const;
type TypeOfChange = (typeof TYPE_OF_CHANGE)[number];

/** Parse error for commit message parsing failures. */
export class ParseError extends Error {
	readonly _tag = "ParseError";
	constructor(
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "ParseError";
	}
}

// ─── Pure core ─────────────────────────────────────────────────────────────

const ISSUE_STARTS_PATTERN = /^(Closes|Fixes|Fix|Resolves|Resolve|Closed|Close) #\d+/i;

const TYPE_MAP: Record<string, TypeOfChange> = {
	feat: "New feature",
	fix: "Bug fix",
	docs: "Documentation update",
	chore: "Chore",
	ci: "Chore",
	build: "Chore",
	refactor: "Chore",
	style: "Chore",
	test: "Chore",
	perf: "Chore",
	revert: "Chore",
};

const parser = new CommitParser();

/** Parser with conventionalcommits preset options (supports feat!, etc.) for single-line validation. */
const validationParser = new CommitParser({
	headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
	headerCorrespondence: ["type", "scope", "subject"],
});

function mapParsedToCommitInfo(
	block: string,
	parsed: ReturnType<CommitParser["parse"]>,
): CommitInfo {
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
		type: (parsed as { type?: string }).type ?? null,
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
			const commits: CommitInfo[] = [];
			for (const block of blocks) {
				const parsed = parser.parse(block);
				commits.push(mapParsedToCommitInfo(block, parsed));
			}
			return commits;
		},
		catch: (e) =>
			new ParseError("Failed to parse commits", e instanceof Error ? e : new Error(String(e))),
	});
}

export function inferTypeOfChange(commits: readonly CommitInfo[]): TypeOfChange {
	const hasBreaking = commits.some((c) => c.breakingNote != null);
	if (hasBreaking) return "Breaking change";
	const first = commits[0];
	if (!first) return "Chore";
	const sub = first.subject;
	if (/^feat!|^feat\(.*\)!:|^BREAKING/.test(sub)) return "Breaking change";

	const type = first.type?.toLowerCase();
	if (type && TYPE_MAP[type]) return TYPE_MAP[type];
	const prefix = sub.toLowerCase().split(":")[0] ?? "";
	return TYPE_MAP[prefix] ?? "Chore";
}

function getTitle(commits: readonly CommitInfo[]): string {
	const first = commits[0];
	return first?.subject ?? "";
}

export function isValidConventionalTitle(s: string): boolean {
	const trimmed = s.trim();
	if (trimmed.length === 0 || trimmed.length > 72) return false;
	const parsed = validationParser.parse(trimmed);
	const type = (parsed as { type?: string }).type;
	return type != null && type.length > 0;
}

export function getDescription(first: CommitInfo): string {
	const body = first.body.trim();
	const firstLine = body.split("\n")[0] ?? "";
	if (body && !ISSUE_STARTS_PATTERN.test(firstLine)) {
		return body.split("\n").slice(0, 20).join("\n");
	}
	const match = /^[^:]+:\s*(.+)$/.exec(first.subject);
	const captured = match?.[1];
	return captured != null ? captured.trim() : first.subject;
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
	const found = new Set<string>();
	for (const c of commits) {
		for (const r of c.references) found.add(r);
	}
	return [...found].toSorted();
}

export function getBreakingChanges(commits: readonly CommitInfo[]): Option.Option<string> {
	for (const c of commits) {
		if (c.breakingNote) return Option.some(c.breakingNote.trim().slice(0, 2000));
	}
	return Option.none();
}

export function fillTemplate(
	commits: readonly CommitInfo[],
	files: readonly string[],
): TemplateData {
	const first = commits[0];
	const typeOfChange = inferTypeOfChange(commits);
	const description = first ? getDescription(first) : "";
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

function buildSubstitutionMap(data: TemplateData): Record<string, string> {
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
	let out = template;
	for (const key of PLACEHOLDERS) {
		const value = map[key];
		const escaped = escapeForSubstitution(value ?? "");
		out = out.replaceAll(`{{${key}}}`, escaped);
	}
	return unescapeAfterSubstitution(out);
}

// ─── Shell (Effect) ────────────────────────────────────────────────────────

function readTemplate(filePath: string): Effect.Effect<string, Error, FileSystem.FileSystem> {
	return pipe(
		FileSystem.FileSystem.asEffect(),
		Effect.flatMap((fs) =>
			fs
				.readFileString(filePath)
				.pipe(
					Effect.mapError((e) => new Error(`Template not found: ${filePath}. ${formatError(e)}`)),
				),
		),
	);
}

function formatError(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
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
): Effect.Effect<readonly [string, readonly string[]], Error, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem.asEffect();
		const [logContent, filesContent] = yield* Effect.all([
			fs
				.readFileString(logFilePath)
				.pipe(
					Effect.mapError(
						(e) => new Error(`Log file not found: ${logFilePath}. ${formatError(e)}`),
					),
				),
			fs
				.readFileString(filesFilePath)
				.pipe(
					Effect.mapError(
						(e) => new Error(`Files file not found: ${filesFilePath}. ${formatError(e)}`),
					),
				),
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
): Effect.Effect<string> {
	const data = fillTemplate(commits, files);
	const body = renderFromTemplate(template, data);
	return body.includes("{{")
		? Effect.gen(function* () {
				yield* Effect.logWarning({
					event: "fill_pr_body",
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
): Effect.Effect<string, Error | ParseError, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const resolvedTemplatePath = resolveTemplatePath(templatePath);

		yield* Effect.log({
			event: "fill_pr_body",
			status: "started",
			logFile: logFilePath,
			filesFile: filesFilePath,
			templatePath: resolvedTemplatePath,
			format,
		});

		const template = yield* readTemplate(resolvedTemplatePath);
		const [logContent, files] = yield* readLogAndFiles(logFilePath, filesFilePath);
		const parseResult = parseCommits(logContent);
		const rawCommits = yield* Effect.fromResult(parseResult);
		const commits = filterMergeCommits(rawCommits);
		const body = yield* renderBody(commits, files, template);
		const title = getTitle(commits);

		if (format === "title-body" && !title.trim()) {
			return yield* Effect.fail(
				new Error(
					"PR title is empty. Add at least one non-merge commit with non-empty subject (e.g. feat: add X) before pushing.",
				),
			);
		}

		const result = format === "title-body" ? `${title}\n\n${body}` : body;

		yield* Effect.log({
			event: "fill_pr_body",
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

const fillCommand = Command.make(
	"fill-pr-body",
	{
		logFile: logFileFlag,
		filesFile: filesFileFlag,
		template: templateFlag,
		format: formatFlag,
		quiet: quietFlag,
		validateTitle: validateTitleFlag,
	},
	({ logFile, filesFile, template, format, quiet, validateTitle }) => {
		const titleToValidate = Option.getOrUndefined(validateTitle);
		if (titleToValidate !== undefined) {
			const valid = isValidConventionalTitle(titleToValidate);
			return Effect.sync(() => {
				process.exit(valid ? 0 : 1);
			});
		}
		const logFilePath = Option.getOrUndefined(logFile);
		const filesFilePath = Option.getOrUndefined(filesFile);
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
		return runFillBody(logFilePath, filesFilePath, Option.getOrUndefined(template), formatVal).pipe(
			Effect.provide(layer),
			Effect.flatMap(Console.log),
		);
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
					event: "fill_pr_body_failed",
					error: formatError(e),
					...(e instanceof Error && e.stack ? { stack: e.stack } : {}),
				}),
			),
		),
	);
}
