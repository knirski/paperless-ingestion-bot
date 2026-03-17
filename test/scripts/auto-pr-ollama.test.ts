import { describe, expect, test } from "bun:test";
import { Effect, FileSystem, Layer, Path, Ref } from "effect";
import * as Http from "effect/unstable/http";
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from "../../scripts/auto-pr/index.js";
import { runAutoPrOllama } from "../../scripts/auto-pr-ollama.js";
import {
	createTestTempDirEffect,
	runWithLayer,
	SilentLoggerLayer,
	TestBaseLayer,
} from "../test-utils.js";

/** Format commit blocks for parseCommits (---COMMIT--- separated). */
function logContent(...blocks: Array<{ subject: string; body: string }>): string {
	const formatted = blocks.map((b) => (b.body ? `${b.subject}\n\n${b.body}`.trim() : b.subject));
	return `---COMMIT---\n${formatted.join("\n---COMMIT---\n")}`;
}

/** Mock HttpClient that returns Ollama-like JSON. First call: title, second: description. */
function createMockOllamaClientLayer(): Layer.Layer<Http.HttpClient.HttpClient> {
	return Layer.effect(
		Http.HttpClient.HttpClient,
		Effect.gen(function* () {
			const callCount = yield* Ref.make(0);
			return Http.HttpClient.make((request) =>
				Effect.gen(function* () {
					const n = yield* Ref.getAndUpdate(callCount, (x) => x + 1);
					const body =
						n === 0
							? JSON.stringify({ response: "feat: test title" })
							: JSON.stringify({ response: "Test description paragraph." });
					const webResponse = new Response(body, {
						headers: { "content-type": "application/json" },
					});
					return Http.HttpClientResponse.fromWeb(request, webResponse);
				}),
			);
		}),
	);
}

const TestLayer = Layer.mergeAll(TestBaseLayer, SilentLoggerLayer, createMockOllamaClientLayer());
const run = runWithLayer(TestLayer);

describe("runAutoPrOllama", () => {
	test("writes title and description to GITHUB_OUTPUT", async () => {
		await run(
			Effect.gen(function* () {
				const tmp = yield* createTestTempDirEffect("auto-pr-ollama-");
				const fs = yield* FileSystem.FileSystem;
				const pathApi = yield* Path.Path;

				const promptsDir = pathApi.join(tmp.path, "scripts", "auto-pr", "prompts");
				yield* fs.makeDirectory(promptsDir, { recursive: true });
				yield* fs.writeFileString(pathApi.join(promptsDir, "pr-title.txt"), "Generate a title.\n");
				yield* fs.writeFileString(
					pathApi.join(promptsDir, "pr-description.txt"),
					"Generate a description.\n",
				);
				yield* fs.writeFileString(
					pathApi.join(tmp.path, "semantic_subjects.txt"),
					"feat: add x\nfix: y\n",
				);
				const commitsPath = pathApi.join(tmp.path, "commits.txt");
				yield* fs.writeFileString(
					commitsPath,
					logContent({ subject: "feat: add x", body: "" }, { subject: "fix: y", body: "" }),
				);

				const ghOutput = pathApi.join(tmp.path, "github_output.txt");

				yield* runAutoPrOllama(
					commitsPath,
					DEFAULT_OLLAMA_MODEL,
					DEFAULT_OLLAMA_URL,
					ghOutput,
					tmp.path,
				);

				const content = yield* fs.readFileString(ghOutput);
				expect(content).toContain("title=");
				expect(content).toContain("description_file=");

				const descPath = pathApi.join(tmp.path, "description.txt");
				const descContent = yield* fs.readFileString(descPath);
				expect(descContent).toContain("Test description paragraph");
			}).pipe(Effect.scoped),
		);
	});
});
