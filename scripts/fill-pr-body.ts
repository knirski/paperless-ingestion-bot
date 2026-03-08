/**
 * Fill PR template from conventional commit messages.
 * Pure core + Effect shell. Run: npx tsx scripts/fill-pr-body.ts [base]
 *
 * Reads .github/PULL_REQUEST_TEMPLATE.md (or --template path), replaces
 * {{placeholder}} values, outputs to stdout. See docs/PR_TEMPLATE.md for
 * how this template works for both manual and automated PRs.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommitParser } from "conventional-commits-parser";
import { Console, Effect, FileSystem, Layer, Logger, Option, Path, pipe, Result } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import pkg from "../package.json" with { type: "json" };
import { GitClient, type GitClientService } from "./git-client.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CommitInfo {
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

const OLLAMA_TITLE_PROMPT = `Generate a single conventional commit title (max 72 chars) that summarizes this PR. Format: type(scope): subject (e.g. feat: add X, fix(ci): resolve bug). Use the most significant type from the commits. Reply with only the title, nothing else.

Commits:
`;

const OLLAMA_MAX_ATTEMPTS = 3;

function fetchOllamaGenerate(
	ollamaBaseUrl: string,
	body: { model: string; prompt: string; stream: boolean },
	signal: AbortSignal,
): Effect.Effect<Response, undefined, never> {
	const url = `${ollamaBaseUrl.replace(/\/$/, "")}/api/generate`;
	return Effect.tryPromise({
		try: () =>
			fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal,
			}),
		catch: () => undefined,
	});
}

export function parseOllamaJson(res: Response): Effect.Effect<string | undefined, never, never> {
	return Effect.tryPromise({
		try: () => res.json() as Promise<{ response?: string }>,
		catch: () => undefined,
	}).pipe(
		Effect.catch(() => Effect.succeed(undefined)),
		Effect.map((body) => {
			const text = body?.response?.trim() ?? "";
			const firstLine = text.split("\n")[0] ?? "";
			return firstLine.slice(0, 72).trim() || undefined;
		}),
	);
}

/** Single Ollama call. Returns first line of response or "" on fetch/parse failure. */
function generateTitleViaOllamaOnce(
	commits: readonly CommitInfo[],
	baseUrl: string,
	model: string,
): Effect.Effect<string, never> {
	const commitLines = commits.map((c) => `- ${c.subject}`).join("\n");
	const prompt = `${OLLAMA_TITLE_PROMPT}${commitLines}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	return fetchOllamaGenerate(baseUrl, { model, prompt, stream: false }, controller.signal).pipe(
		Effect.flatMap((res) => (res?.ok ? parseOllamaJson(res) : Effect.succeed(undefined))),
		Effect.map((s) => s ?? ""),
		Effect.catch(() => Effect.succeed("")),
		Effect.ensuring(Effect.sync(() => clearTimeout(timeout))),
	);
}

/** Call Ollama up to 3 times; validate response. Fallback to getTitle if all fail or are invalid. */
function generateTitleViaOllama(
	commits: readonly CommitInfo[],
	baseUrl: string,
	model: string,
): Effect.Effect<string, never> {
	const fallback = getTitle(commits);
	function attempt(n: number): Effect.Effect<string, never> {
		if (n >= OLLAMA_MAX_ATTEMPTS) return Effect.succeed(fallback);
		return generateTitleViaOllamaOnce(commits, baseUrl, model).pipe(
			Effect.flatMap((result) =>
				isValidConventionalTitle(result) ? Effect.succeed(result) : attempt(n + 1),
			),
		);
	}
	return attempt(0);
}

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

function fetchLogAndDiff(
	git: GitClientService,
	ref: string,
): Effect.Effect<readonly [string, readonly string[]], Error> {
	return Effect.all([git.log(ref), git.diffNames(ref)]);
}

function tryOriginFallback(
	git: GitClientService,
	base: string,
	originBase: string,
	e1: unknown,
): Effect.Effect<readonly [string, readonly string[]], Error> {
	return Effect.gen(function* () {
		yield* Effect.log({
			event: "fetch_commits_fallback",
			base,
			originBase,
			reason: formatError(e1),
		});
		return yield* fetchLogAndDiff(git, originBase).pipe(
			Effect.mapError(
				(e2) =>
					new Error(`Base branch "${base}" not found. Tried ${originBase}: ${formatError(e2)}`),
			),
		);
	});
}

/** Fetch log and diff; fallback to origin/base when base fails (e.g. local branch missing in shallow clone). */
export function fetchCommitsAndFiles(
	git: GitClientService,
	base: string,
): Effect.Effect<readonly [string, readonly string[]], Error> {
	const originBase = base.startsWith("origin/") ? base : `origin/${base}`;
	return fetchLogAndDiff(git, base).pipe(
		Effect.catch((e1) =>
			originBase === base
				? Effect.fail(new Error(`Base branch "${base}" not found: ${formatError(e1)}`))
				: tryOriginFallback(git, base, originBase, e1),
		),
	);
}

export type OutputFormat = "body" | "title-body";

export interface RunFillBodyOptions {
	readonly aiTitle?: boolean;
	readonly ollamaUrl?: string;
	readonly ollamaModel?: string;
}

function resolveBaseAndTemplate(
	baseArg: string | undefined,
	templatePath: string | undefined,
): Effect.Effect<
	readonly [base: string, resolvedTemplatePath: string],
	Error,
	GitClient | Path.Path
> {
	return Effect.gen(function* () {
		const path = yield* Path.Path.asEffect();
		const git = yield* GitClient;
		const base = baseArg ?? (yield* git.defaultBranch());
		const repoRoot = yield* git.repoRoot();
		const resolvedTemplatePath = templatePath
			? path.isAbsolute(templatePath)
				? templatePath
				: path.resolve(repoRoot, templatePath)
			: path.resolve(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md");
		return [base, resolvedTemplatePath] as const;
	});
}

function fetchAndParseCommits(
	git: GitClientService,
	base: string,
): Effect.Effect<readonly [readonly CommitInfo[], readonly string[]], Error | ParseError> {
	return fetchCommitsAndFiles(git, base).pipe(
		Effect.flatMap(([logOut, files]) => {
			const parseResult = parseCommits(logOut);
			return Effect.fromResult(parseResult).pipe(Effect.map((commits) => [commits, files]));
		}),
	);
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

function computeTitle(
	commits: readonly CommitInfo[],
	options: RunFillBodyOptions,
): Effect.Effect<string, never> {
	if (options.aiTitle && commits.length > 1) {
		return generateTitleViaOllama(
			commits,
			options.ollamaUrl ?? "http://localhost:11434",
			options.ollamaModel ?? "llama3.2:1b",
		);
	}
	return Effect.succeed(getTitle(commits));
}

export function runFillBody(
	baseArg: string | undefined,
	templatePath: string | undefined,
	format: OutputFormat = "body",
	options: RunFillBodyOptions = {},
): Effect.Effect<string, Error | ParseError, FileSystem.FileSystem | GitClient | Path.Path> {
	return Effect.gen(function* () {
		const [base, resolvedTemplatePath] = yield* resolveBaseAndTemplate(baseArg, templatePath);

		yield* Effect.log({
			event: "fill_pr_body",
			status: "started",
			base,
			templatePath: resolvedTemplatePath,
			format,
		});

		const git = yield* GitClient;
		const template = yield* readTemplate(resolvedTemplatePath);
		const [rawCommits, files] = yield* fetchAndParseCommits(git, base);
		const commits = filterMergeCommits(rawCommits);
		const body = yield* renderBody(commits, files, template);
		const title = yield* computeTitle(commits, options);

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
			base,
			commitsCount: commits.length,
			filesCount: files.length,
		});
		return result;
	});
}

const baseArg = Argument.string("base").pipe(
	Argument.optional,
	Argument.withDescription("Base branch to compare against (default: inferred from origin/HEAD)"),
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

const aiTitleFlag = Flag.boolean("ai-title").pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		"Generate PR title via Ollama (falls back to first commit subject on failure).",
	),
);

const ollamaUrlFlag = Flag.string("ollama-url").pipe(
	Flag.optional,
	Flag.withDescription("Ollama base URL (default: http://localhost:11434)."),
);

const ollamaModelFlag = Flag.string("ollama-model").pipe(
	Flag.optional,
	Flag.withDescription("Ollama model for title generation (default: llama3.2:1b)."),
);

const fillCommand = Command.make(
	"fill-pr-body",
	{
		base: baseArg,
		template: templateFlag,
		format: formatFlag,
		quiet: quietFlag,
		aiTitle: aiTitleFlag,
		ollamaUrl: ollamaUrlFlag,
		ollamaModel: ollamaModelFlag,
	},
	({ base, template, format, quiet, aiTitle, ollamaUrl, ollamaModel }) => {
		const formatVal = Option.getOrUndefined(format) === "title-body" ? "title-body" : "body";
		const url = Option.getOrUndefined(ollamaUrl);
		const model = Option.getOrUndefined(ollamaModel);
		const options: RunFillBodyOptions = {
			...(aiTitle && {
				aiTitle: true,
				...(url != null && url !== "" && { ollamaUrl: url }),
				...(model != null && model !== "" && { ollamaModel: model }),
			}),
		};
		const loggerLayer = quiet
			? Logger.layer([])
			: Logger.layer([Logger.consolePretty({ colors: process.env.NO_COLOR === undefined })]).pipe(
					Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
				);
		// Provide our own layer so --quiet controls logging (vs. CliLayer used by top-level).
		const layer = NodeServices.layer.pipe(
			Layer.provideMerge(GitClient.Live),
			Layer.provideMerge(loggerLayer),
		);
		return runFillBody(
			Option.getOrUndefined(base),
			Option.getOrUndefined(template),
			formatVal,
			options,
		).pipe(Effect.provide(layer), Effect.flatMap(Console.log));
	},
);

const cliProgram = Command.run(fillCommand, { version: pkg.version });

/** Respect NO_COLOR (https://no-color.org): disable colors when set, for CI/scripting. */
const LoggerLayer = Logger.layer([
	Logger.consolePretty({ colors: process.env.NO_COLOR === undefined }),
]).pipe(Layer.provide(Layer.succeed(Logger.LogToStderr)(true)));

/** CLI services: NodeServices + GitClient + Logger. */
const CliLayer = NodeServices.layer.pipe(
	Layer.provideMerge(GitClient.Live),
	Layer.provideMerge(LoggerLayer),
);

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
