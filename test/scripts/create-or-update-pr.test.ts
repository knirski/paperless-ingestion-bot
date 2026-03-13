import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { runCreateOrUpdatePr } from "../../scripts/create-or-update-pr.js";
import {
	ChildProcessSpawnerTestMock,
	createTestTempDirEffect,
	SilentLoggerLayer,
	TestBaseLayer,
} from "../test-utils.js";

const TestLayer = Layer.mergeAll(TestBaseLayer, SilentLoggerLayer, ChildProcessSpawnerTestMock);

layer(TestLayer)("runCreateOrUpdatePr", (it) => {
	it.effect("fails when PR_TITLE blank and semantic_subjects missing", () =>
		Effect.gen(function* () {
			const tmp = yield* createTestTempDirEffect("create-pr-");
			// No semantic_subjects.txt - readPrTitleFallback will fail
			const exit = yield* runCreateOrUpdatePr({
				branch: "ai/test",
				defaultBranch: "main",
				commits: tmp.join("c.txt"),
				files: tmp.join("f.txt"),
				prTitle: "",
				workspace: tmp.path,
			}).pipe(Effect.exit);
			expect(exit._tag).toBe("Failure");
		}).pipe(Effect.scoped),
	);

	it.effect("fails when PR_TITLE blank and semantic_subjects empty", () =>
		Effect.gen(function* () {
			const tmp = yield* createTestTempDirEffect("create-pr-");
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString(tmp.join("semantic_subjects.txt"), "");
			yield* fs.writeFileString(tmp.join("c.txt"), "---COMMIT---\nfeat: x");
			yield* fs.writeFileString(tmp.join("f.txt"), "a.ts");

			const exit = yield* runCreateOrUpdatePr({
				branch: "ai/test",
				defaultBranch: "main",
				commits: tmp.join("c.txt"),
				files: tmp.join("f.txt"),
				prTitle: "",
				workspace: tmp.path,
			}).pipe(Effect.exit);
			expect(exit._tag).toBe("Failure");
		}).pipe(Effect.scoped),
	);

	it.effect("succeeds when PR_TITLE provided and ChildProcessSpawner mocked", () =>
		Effect.gen(function* () {
			const tmp = yield* createTestTempDirEffect("create-pr-");
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString(tmp.join("c.txt"), "---COMMIT---\nfeat: add x");
			yield* fs.writeFileString(tmp.join("f.txt"), "a.ts");

			yield* runCreateOrUpdatePr({
				branch: "ai/test",
				defaultBranch: "main",
				commits: tmp.join("c.txt"),
				files: tmp.join("f.txt"),
				prTitle: "feat: add x",
				workspace: tmp.path,
			});
		}).pipe(Effect.scoped),
	);
});
