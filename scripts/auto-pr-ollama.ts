/**
 * Generate PR title and description via Ollama. Only runs when 2+ semantic commits (workflow condition).
 *
 * Requires env: COMMITS (path to commits.txt), GITHUB_OUTPUT
 * Optional env: OLLAMA_MODEL (default: see DEFAULT_OLLAMA_MODEL), OLLAMA_URL (default: see DEFAULT_OLLAMA_URL), GITHUB_WORKSPACE
 * Reads: semantic_subjects.txt, scripts/auto-pr/prompts/pr-title.txt, scripts/auto-pr/prompts/pr-description.txt
 * Outputs: title, description_file
 *
 * Run: npx tsx scripts/auto-pr-ollama.ts
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Duration, Effect, FileSystem, Layer, Logger, Path, Schedule, Schema } from "effect";
import * as Http from "effect/unstable/http";
import {
	AutoPrOllamaConfig,
	AutoPrOllamaConfigLayer,
	AutoPrPlatformLayer,
	appendGhOutput,
	buildDescriptionPrompt,
	buildTitlePrompt,
	formatAutoPrError,
	OllamaHttpError,
	parseSubjects,
	sanitizeForGhOutput,
	trimOllamaResponse,
	validateDescriptionResponse,
	validateTitleResponse,
} from "./auto-pr/index.js";
import {
	filterMergeCommits,
	getDescriptionPromptText,
	isValidConventionalTitle,
	parseCommits,
} from "./fill-pr-template.js";

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

const OllamaResponseSchema = Schema.Struct({
	response: Schema.optional(Schema.String),
});

// ─── Shell (Effect) ──────────────────────────────────────────────────────────

interface InputFiles {
	readonly titlePrompt: string;
	readonly descPrompt: string;
	readonly subjects: string[];
	readonly logContent: string;
}

function readInputFiles(
	commitsPath: string,
	workspace: string,
): Effect.Effect<InputFiles, Error, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pathApi = yield* Path.Path;
		const titlePath = pathApi.join(workspace, "scripts/auto-pr/prompts/pr-title.txt");
		const descPath = pathApi.join(workspace, "scripts/auto-pr/prompts/pr-description.txt");
		const subjectsPath = pathApi.join(workspace, "semantic_subjects.txt");
		const [titlePrompt, descPrompt, subjectsContent, logContent] = yield* Effect.all([
			fs
				.readFileString(titlePath)
				.pipe(Effect.mapError((e) => new Error(`pr-title.txt: ${String(e)}`))),
			fs
				.readFileString(descPath)
				.pipe(Effect.mapError((e) => new Error(`pr-description.txt: ${String(e)}`))),
			fs
				.readFileString(subjectsPath)
				.pipe(Effect.mapError((e) => new Error(`semantic_subjects.txt: ${String(e)}`))),
			fs
				.readFileString(commitsPath)
				.pipe(Effect.mapError((e) => new Error(`commits: ${String(e)}`))),
		]);
		return {
			titlePrompt,
			descPrompt,
			subjects: parseSubjects(subjectsContent),
			logContent,
		};
	});
}

function callOllama(
	ollamaUrl: string,
	model: string,
	prompt: string,
): Effect.Effect<string, Error, Http.HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const req = Http.HttpClientRequest.post(ollamaUrl, {
			body: Http.HttpBody.jsonUnsafe({ model, prompt, stream: false }),
		});
		const res = yield* client
			.execute(req)
			.pipe(
				Effect.flatMap((r) =>
					r.status >= 400
						? Effect.fail(new OllamaHttpError({ status: r.status, cause: `HTTP ${r.status}` }))
						: Effect.succeed(r),
				),
			);
		const raw = yield* res.json;
		const decoded = yield* Schema.decodeUnknownEffect(OllamaResponseSchema)(raw).pipe(
			Effect.mapError((e) => new OllamaHttpError({ cause: `response: ${String(e)}` })),
		);
		const response = decoded.response ?? "";
		return trimOllamaResponse(response);
	});
}

const retrySchedule = Schedule.recurs(MAX_ATTEMPTS - 1).pipe(
	Schedule.addDelay(() => Effect.succeed(Duration.millis(RETRY_DELAY_MS))),
);

function generateTitle(
	ollamaUrl: string,
	model: string,
	prompt: string,
): Effect.Effect<string, Error, Http.HttpClient.HttpClient> {
	return callOllama(ollamaUrl, model, prompt).pipe(
		Effect.flatMap((raw) =>
			Effect.fromResult(validateTitleResponse(raw, isValidConventionalTitle)),
		),
		Effect.retry(retrySchedule),
	);
}

function generateDescription(
	ollamaUrl: string,
	model: string,
	prompt: string,
): Effect.Effect<string, Error, Http.HttpClient.HttpClient> {
	return callOllama(ollamaUrl, model, prompt).pipe(
		Effect.flatMap((raw) => Effect.fromResult(validateDescriptionResponse(raw))),
		Effect.retry(retrySchedule),
	);
}

/** Main pipeline. Exported for tests. */
export function runAutoPrOllama(
	commitsPath: string,
	model: string,
	ollamaUrl: string,
	ghOutputPath: string,
	workspace: string,
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path | Http.HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const pathApi = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;

		const input = yield* readInputFiles(commitsPath, workspace);
		const titlePromptFull = buildTitlePrompt(input.titlePrompt, input.subjects);

		let title = yield* generateTitle(ollamaUrl, model, titlePromptFull).pipe(
			Effect.catch(() =>
				Effect.logWarning("Ollama title attempts failed, using first subject").pipe(
					Effect.as(input.subjects[0] ?? ""),
				),
			),
		);
		if (!title || !isValidConventionalTitle(title)) {
			yield* Effect.logError("Failed to generate valid PR title, using first subject");
			title = input.subjects[0] ?? "";
		}

		const parseResult = parseCommits(input.logContent);
		const rawCommits = yield* Effect.fromResult(parseResult);
		const commits = filterMergeCommits(rawCommits);
		const commitContent = getDescriptionPromptText(commits);
		const descPromptFull = buildDescriptionPrompt(input.descPrompt, commitContent);

		const desc = yield* generateDescription(ollamaUrl, model, descPromptFull).pipe(
			Effect.catch(() => Effect.succeed("")),
		);

		const hasDesc = Boolean(desc && desc !== "null");
		const descPath = hasDesc ? pathApi.join(workspace, "description.txt") : "";

		if (hasDesc) {
			yield* fs
				.writeFileString(descPath, desc)
				.pipe(Effect.mapError((e) => new Error(`write description: ${String(e)}`)));
		} else {
			yield* Effect.logError("Failed to generate PR description with Ollama");
		}

		const titleValue = sanitizeForGhOutput(title);
		const entries = [
			{ key: "title", value: titleValue },
			{ key: "description_file", value: descPath },
		];
		yield* appendGhOutput(ghOutputPath, entries);
	});
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
	const config = yield* AutoPrOllamaConfig;
	const { commits, ghOutput, model, ollamaUrl, workspace } = config.config;

	const layer = AutoPrPlatformLayer.pipe(Layer.provideMerge(Http.FetchHttpClient.layer));
	yield* runAutoPrOllama(commits, model, ollamaUrl, ghOutput, workspace).pipe(
		Effect.provide(layer),
	);
});

const MainLayer = Logger.layer([
	Logger.consolePretty({ colors: process.env.NO_COLOR === undefined }),
]).pipe(Layer.provide(Layer.succeed(Logger.LogToStderr)(true)));

if (import.meta.main) {
	NodeRuntime.runMain(
		program.pipe(
			Effect.provide(MainLayer),
			Effect.provide(AutoPrOllamaConfigLayer),
			Effect.tapError((e) =>
				Effect.logError({
					event: "auto_pr_ollama_failed",
					error: formatAutoPrError(e),
				}),
			),
			Effect.exit,
			Effect.flatMap((exit) =>
				Effect.sync(() => {
					process.exit(exit._tag === "Success" ? 0 : 1);
				}),
			),
		),
	);
}
