import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { appendGhOutput } from "../../../scripts/auto-pr/index.js";
import { createTestTempDirEffect, TestBaseLayer } from "../../test-utils.js";

layer(TestBaseLayer)("appendGhOutput", (it) => {
	it.effect("writes entries to file", () =>
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

	it.effect("appends to existing file", () =>
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
