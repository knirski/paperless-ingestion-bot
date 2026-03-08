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
					Effect.mapError(
						(e) =>
							new Error(
								`Template not found: ${filePath}. ${e instanceof Error ? e.message : String(e)}`,
							),
					),
				),
		),
	);
}

/** Fetch log and diff; fallback to origin/base when base fails (e.g. local branch missing in shallow clone). */
export function fetchCommitsAndFiles(
	git: GitClientService,
	base: string,
): Effect.Effect<readonly [string, readonly string[]], Error> {
	const originBase = base.startsWith("origin/") ? base : `origin/${base}`;
	return Effect.all([git.log(base), git.diffNames(base)]).pipe(
		Effect.catch((e1) =>
			originBase === base
				? Effect.fail(
						new Error(
							`Base branch "${base}" not found: ${e1 instanceof Error ? e1.message : String(e1)}`,
						),
					)
				: Effect.gen(function* () {
						yield* Effect.log({
							event: "fetch_commits_fallback",
							base,
							originBase,
							reason: e1 instanceof Error ? e1.message : String(e1),
						});
						return yield* Effect.all([git.log(originBase), git.diffNames(originBase)]).pipe(
							Effect.mapError(
								(e2) =>
									new Error(
										`Base branch "${base}" not found. Tried ${originBase}: ${e2 instanceof Error ? e2.message : String(e2)}`,
									),
							),
						);
					}),
		),
	);
}

export type OutputFormat = "body" | "title-body";

export function runFillBody(
	baseArg: string | undefined,
	templatePath: string | undefined,
	format: OutputFormat = "body",
): Effect.Effect<string, Error | ParseError, FileSystem.FileSystem | GitClient | Path.Path> {
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

		yield* Effect.log({
			event: "fill_pr_body",
			status: "started",
			base,
			templatePath: resolvedTemplatePath,
			format,
		});

		const template = yield* readTemplate(resolvedTemplatePath);

		const [logOut, files] = yield* fetchCommitsAndFiles(git, base);

		const parseResult = parseCommits(logOut);
		const commits = yield* Effect.fromResult(parseResult);

		const data = fillTemplate(commits, files);
		const body = renderFromTemplate(template, data);
		if (body.includes("{{")) {
			yield* Effect.logWarning({
				event: "fill_pr_body",
				message: "Output contains unreplaced {{placeholder}}s",
			});
		}

		const title = getTitle(commits);
		if (format === "title-body" && !title.trim()) {
			return yield* Effect.fail(
				new Error(
					"PR title is empty. Add at least one conventional commit (e.g. feat: add X) before pushing.",
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
	Flag.withDescription("Suppress log output (use when capturing stdout for piping)."),
);

const fillCommand = Command.make(
	"fill-pr-body",
	{ base: baseArg, template: templateFlag, format: formatFlag, quiet: quietFlag },
	({ base, template, format, quiet }) => {
		const formatVal = Option.getOrUndefined(format) === "title-body" ? "title-body" : "body";
		const QuietLayer = NodeServices.layer.pipe(
			Layer.provideMerge(GitClient.Live),
			Layer.provideMerge(Logger.layer([])),
		);
		return runFillBody(
			Option.getOrUndefined(base),
			Option.getOrUndefined(template),
			formatVal,
		).pipe(Effect.flatMap(Console.log), Effect.provide(quiet ? QuietLayer : CliLayer));
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
					error: e instanceof Error ? e.message : String(e),
					...(e instanceof Error && e.stack ? { stack: e.stack } : {}),
				}),
			),
		),
	);
}
