import { describe, expect, test } from "bun:test";
import { Effect, FileSystem } from "effect";
import { appendGhOutput } from "../../../scripts/auto-pr/index.js";
import { createTestTempDirEffect, runWithLayer, TestBaseLayer } from "../../test-utils.js";

const run = runWithLayer(TestBaseLayer);

describe("appendGhOutput", () => {
	test("writes entries to file", async () => {
		await run(
			Effect.gen(function* () {
				const tmp = yield* createTestTempDirEffect("auto-pr-shell-");
				const path = tmp.join("github_output.txt");

				yield* appendGhOutput(path, [
					{ key: "a", value: "1" },
					{ key: "b", value: "2" },
				]);

				const fs = yield* FileSystem.FileSystem;
				const content = yield* fs.readFileString(path);
				expect(content).toContain("a=1");
				expect(content).toContain("b=2");
			}).pipe(Effect.scoped),
		);
	});

	test("appends to existing file", async () => {
		await run(
			Effect.gen(function* () {
				const tmp = yield* createTestTempDirEffect("auto-pr-shell-");
				const path = tmp.join("github_output.txt");
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString(path, "existing=line\n");

				yield* appendGhOutput(path, [{ key: "new", value: "value" }]);

				const content = yield* fs.readFileString(path);
				expect(content).toContain("existing=line");
				expect(content).toContain("new=value");
			}).pipe(Effect.scoped),
		);
	});
});
