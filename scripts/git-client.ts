/**
 * Git client for fill-pr-body script.
 * Tagless Final: interface + live interpreter wrapping simple-git.
 * Exposes only the operations needed for PR body generation.
 */

import { Effect, Layer, pipe, ServiceMap } from "effect";
import { simpleGit } from "simple-git";

export interface GitClientService {
	/** Log commits from base..HEAD as ---COMMIT--- blocks for parseCommits. */
	readonly log: (base: string) => Effect.Effect<string, Error>;
	/** Changed file names between base and HEAD. */
	readonly diffNames: (base: string) => Effect.Effect<readonly string[], never>;
	/** Default branch (e.g. main), falls back to "main" if origin/HEAD missing. */
	readonly defaultBranch: () => Effect.Effect<string, never>;
	/** Repository root path. */
	readonly repoRoot: () => Effect.Effect<string, Error>;
}

function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e));
}

function tryGit<T>(fn: () => Promise<T>): Effect.Effect<T, Error> {
	return Effect.tryPromise({ try: fn, catch: toError });
}

function createGitClient(cwd?: string): GitClientService {
	const git = cwd ? simpleGit(cwd) : simpleGit();
	return {
		log: (base) =>
			tryGit(async () => {
				const result = await git.log({
					from: base,
					format: { subject: "%s", body: "%b" },
				});
				const blocks = result.all.map((c) => {
					const s = (c as { subject?: string }).subject ?? "";
					const b = (c as { body?: string }).body ?? "";
					return b ? `${s}\n\n${b}`.trim() : s;
				});
				return blocks.join("\n---COMMIT---\n");
			}),
		diffNames: (base) =>
			pipe(
				tryGit(() =>
					git.diffSummary([`${base}..HEAD`, "--name-only"]).then((r) => r.files.map((f) => f.file)),
				),
				Effect.catch(() => Effect.succeed([] as readonly string[])),
			),
		defaultBranch: () =>
			pipe(
				tryGit(() => git.revparse(["--abbrev-ref", "origin/HEAD"])),
				Effect.map((ref) => ref.trim().replace(/^origin\//, "")),
				Effect.catch(() => Effect.succeed("main")),
			),
		repoRoot: () =>
			tryGit(() => git.revparse(["--show-toplevel"])).pipe(Effect.map((s) => s.trim())),
	};
}

export class GitClient extends ServiceMap.Service<GitClient, GitClientService>()(
	"paperless-ingestion-bot/scripts/git-client",
) {
	static readonly Live: Layer.Layer<GitClient, never> = Layer.sync(GitClient, () =>
		createGitClient(),
	);
	static LiveWithCwd = (cwd: string): Layer.Layer<GitClient, never> =>
		Layer.sync(GitClient, () => createGitClient(cwd));
}
