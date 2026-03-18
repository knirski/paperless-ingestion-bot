/**
 * Create or update a PR from fill-pr-template output.
 *
 * Requires env: GH_TOKEN, BRANCH, DEFAULT_BRANCH, COMMITS, FILES
 * Optional env: PR_TITLE (from title step when 2+ commits; when empty, uses first line of semantic_subjects.txt)
 * Optional env: DESCRIPTION_FILE (Ollama-generated description when 2+ semantic commits)
 *
 * Run: bun run scripts/create-or-update-pr.ts
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Duration, Effect, FileSystem, Layer, Logger, Path, Schedule } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import type { FileSystemError } from "../src/domain/errors.js";
import { mapFsError } from "../src/shell/fs-utils.js";
import type { GhPrFailed, ParseError } from "./auto-pr/index.js";
import {
	AutoPrConfigError,
	AutoPrPlatformLayer,
	ChildProcessSpawnerLayer,
	CreateOrUpdatePrConfig,
	CreateOrUpdatePrConfigLayer,
	firstLine,
	formatAutoPrError,
	isBlank,
	PrTitleBlank,
	runCommand,
} from "./auto-pr/index.js";
import { runFillBody } from "./fill-pr-template.js";

// ─── Constants ────────────────────────────────────────────────────────────

const GH_RETRY_ATTEMPTS = 3;
const GH_RETRY_DELAY_MS = 5000;

// ─── Shell (Effect) ──────────────────────────────────────────────────────────

function readPrTitleFallback(
	workspace: string,
): Effect.Effect<string, FileSystemError, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pathApi = yield* Path.Path;
		const subjectsPath = pathApi.join(workspace, "semantic_subjects.txt");
		const content = yield* fs
			.readFileString(subjectsPath)
			.pipe(mapFsError(subjectsPath, "readFileString"));
		return firstLine(content);
	});
}

function ghPrView(branch: string, cwd: string): Effect.Effect<boolean, Error, ChildProcessSpawner> {
	return runCommand("gh", ["pr", "view", branch], cwd).pipe(
		Effect.as(true),
		Effect.catch(() => Effect.succeed(false)),
	);
}

function ghPrEdit(
	branch: string,
	title: string,
	bodyPath: string,
	cwd: string,
): Effect.Effect<void, Error, ChildProcessSpawner> {
	return runCommand("gh", ["pr", "edit", branch, "--title", title, "--body-file", bodyPath], cwd);
}

function ghPrCreate(
	_branch: string,
	baseBranch: string,
	title: string,
	bodyPath: string,
	cwd: string,
): Effect.Effect<void, Error, ChildProcessSpawner> {
	return runCommand(
		"gh",
		["pr", "create", "--base", baseBranch, "--title", title, "--body-file", bodyPath],
		cwd,
	);
}

function runGhWithRetry<R, E>(effect: Effect.Effect<void, E, R>): Effect.Effect<void, E, R> {
	const schedule = Schedule.recurs(GH_RETRY_ATTEMPTS - 1).pipe(
		Schedule.addDelay(() =>
			Effect.logWarning("gh failed, retrying in 5s...").pipe(
				Effect.as(Duration.millis(GH_RETRY_DELAY_MS)),
			),
		),
	);
	return effect.pipe(
		Effect.retry(schedule),
		Effect.tapError(() => Effect.logError("gh pr failed after 3 attempts")),
	);
}

type CreateOrUpdatePrError = PrTitleBlank | FileSystemError | GhPrFailed | ParseError | Error;

/** Main pipeline. Exported for tests. */
export function runCreateOrUpdatePr(params: {
	branch: string;
	defaultBranch: string;
	commits: string;
	files: string;
	prTitle: string;
	descriptionFile?: string;
	workspace: string;
}): Effect.Effect<
	void,
	CreateOrUpdatePrError,
	ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
	return Effect.gen(function* () {
		let prTitle = params.prTitle.trim();
		if (isBlank(prTitle)) {
			prTitle = yield* readPrTitleFallback(params.workspace);
		}
		if (isBlank(prTitle)) {
			return yield* Effect.fail(
				new PrTitleBlank({
					message:
						"PR_TITLE is empty or whitespace-only. Add at least one non-merge commit with non-empty subject.",
				}),
			);
		}

		const descriptionOverride = params.descriptionFile?.trim() || undefined;
		const body = yield* runFillBody(
			params.commits,
			params.files,
			undefined,
			"body",
			descriptionOverride,
		);

		const fs = yield* FileSystem.FileSystem;
		const bodyPath = yield* fs.makeTempFile({ prefix: "pr-body-", suffix: ".md" });
		yield* fs.writeFileString(bodyPath, body);

		const pathApi = yield* Path.Path;
		const cwd = pathApi.join(params.workspace);

		const exists = yield* ghPrView(params.branch, cwd);
		if (exists) {
			yield* Effect.log("PR exists, updating...");
			yield* runGhWithRetry(ghPrEdit(params.branch, prTitle, bodyPath, cwd));
		} else {
			yield* Effect.log("Creating PR...");
			yield* runGhWithRetry(
				ghPrCreate(params.branch, params.defaultBranch, prTitle, bodyPath, cwd),
			);
		}
	});
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
	const config = yield* CreateOrUpdatePrConfig;
	const { branch, defaultBranch, commits, files, prTitle, descriptionFile, workspace } =
		config.config;

	if (!process.env.GH_TOKEN) {
		return yield* Effect.fail(new AutoPrConfigError({ missing: ["GH_TOKEN"] }));
	}

	yield* runCreateOrUpdatePr({
		branch,
		defaultBranch,
		commits,
		files,
		prTitle,
		...(descriptionFile ? { descriptionFile } : {}),
		workspace,
	});
}).pipe(
	Effect.provide(AutoPrPlatformLayer),
	Effect.provide(ChildProcessSpawnerLayer),
	Effect.provide(CreateOrUpdatePrConfigLayer),
);

const MainLayer = Logger.layer([
	Logger.consolePretty({ colors: process.env.NO_COLOR === undefined }),
]).pipe(Layer.provide(Layer.succeed(Logger.LogToStderr)(true)));

if (import.meta.main) {
	NodeRuntime.runMain(
		program.pipe(
			Effect.provide(MainLayer),
			Effect.tapError((e) =>
				Effect.logError({
					event: "create_or_update_pr_failed",
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
