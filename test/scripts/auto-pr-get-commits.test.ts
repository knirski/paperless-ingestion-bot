import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { ChildProcessSpawnerLayer } from "../../scripts/auto-pr/index.js";
import { runAutoPrGetCommits } from "../../scripts/auto-pr-get-commits.js";
import { createTestTempDirEffect, SilentLoggerLayer, TestBaseLayer } from "../test-utils.js";

const TestLayer = Layer.mergeAll(TestBaseLayer, SilentLoggerLayer, ChildProcessSpawnerLayer);

/** Create a minimal git repo with commits ahead of origin/main. */
function setupGitRepo(
	workspace: string,
	commits: Array<{ message: string }>,
): Effect.Effect<void, Error, ChildProcessSpawner> {
	return Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		const run = (args: string[]) =>
			spawner
				.string(ChildProcess.make("git", args, { cwd: workspace }))
				.pipe(Effect.mapError((e) => new Error(String(e))));

		yield* run(["init"]);
		yield* run(["config", "user.email", "test@test.com"]);
		yield* run(["config", "user.name", "Test"]);
		yield* run(["config", "init.defaultBranch", "main"]);
		yield* run(["commit", "--allow-empty", "-m", "init"]);
		for (const { message } of commits) {
			yield* run(["commit", "--allow-empty", "-m", message]);
		}
		const n = commits.length;
		yield* run(["update-ref", "refs/remotes/origin/main", `HEAD~${n}`]);
	});
}

layer(TestLayer)("runAutoPrGetCommits", (it) => {
	it.effect("writes output files and GITHUB_OUTPUT for single semantic commit", () =>
		Effect.gen(function* () {
			const tmp = yield* createTestTempDirEffect("auto-pr-get-commits-");
			yield* setupGitRepo(tmp.path, [{ message: "feat: add feature" }]);

			const ghOutput = tmp.join("github_output.txt");
			yield* runAutoPrGetCommits("main", tmp.path, ghOutput);

			const fs = yield* FileSystem.FileSystem;
			const content = yield* fs.readFileString(ghOutput);
			expect(content).toContain("commits=");
			expect(content).toContain("files=");
			expect(content).toContain("count=1");

			const commitsPath = tmp.join("commits.txt");
			const commitsContent = yield* fs.readFileString(commitsPath);
			expect(commitsContent).toContain("feat: add feature");
		}).pipe(Effect.scoped),
	);

	it.effect("writes correct count and files for multiple semantic commits", () =>
		Effect.gen(function* () {
			const tmp = yield* createTestTempDirEffect("auto-pr-get-commits-multi-");
			yield* setupGitRepo(tmp.path, [{ message: "feat: add x" }, { message: "fix: resolve y" }]);

			const ghOutput = tmp.join("github_output.txt");
			yield* runAutoPrGetCommits("main", tmp.path, ghOutput);

			const fs = yield* FileSystem.FileSystem;
			const ghContent = yield* fs.readFileString(ghOutput);
			expect(ghContent).toContain("count=2");

			const subjectsContent = yield* fs.readFileString(tmp.join("subjects.txt"));
			expect(subjectsContent).toContain("feat: add x");
			expect(subjectsContent).toContain("fix: resolve y");

			const semanticContent = yield* fs.readFileString(tmp.join("semantic_subjects.txt"));
			expect(semanticContent).toContain("feat: add x");
			expect(semanticContent).toContain("fix: resolve y");
		}).pipe(Effect.scoped),
	);

	it.effect("fails when no semantic commits", () =>
		Effect.gen(function* () {
			const tmp = yield* createTestTempDirEffect("auto-pr-get-commits-empty-");
			yield* setupGitRepo(tmp.path, [{ message: "Merge branch 'x'" }]);
			// origin/main = init, HEAD = "Merge x" (1 commit ahead, 0 semantic)

			const exit = yield* runAutoPrGetCommits("main", tmp.path, tmp.join("out.txt")).pipe(
				Effect.exit,
			);

			expect(exit._tag).toBe("Failure");
		}).pipe(Effect.scoped),
	);
});
