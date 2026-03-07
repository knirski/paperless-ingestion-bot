import { assert, layer } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import { collisionCandidateFilename, splitFilenameForCollision } from "../src/core/index.js";
import { mapFsError, resolveOutputPath } from "../src/shell/fs-utils.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import {
	createTestTempDir,
	createTestTempDirEffect,
	pathExists,
	SilentLoggerLayer,
} from "./test-utils.js";

describe("mapFsError", () => {
	test("wraps Effect failure as FileSystemError", async () => {
		const failingEffect = Effect.fail(new Error("ENOENT"));
		const mapped = failingEffect.pipe(mapFsError("/tmp/x", "exists"));
		const exit = await Effect.runPromise(Effect.exit(mapped));
		expect(Exit.isFailure(exit)).toBe(true);
		const errOpt = Exit.findErrorOption(exit);
		expect(Option.isSome(errOpt)).toBe(true);
		if (Option.isSome(errOpt)) {
			expect(errOpt.value).toMatchObject({
				_tag: "FileSystemError",
				path: "/tmp/x",
				operation: "exists",
			});
		}
	});
});

const ResolveOutputPathLayer = Layer.mergeAll(PlatformServicesLayer, SilentLoggerLayer);

layer(ResolveOutputPathLayer)("resolveOutputPath", (it) => {
	it.effect.each([
		{ baseFilename: "doc.pdf", existing: [] as string[], expectedSuffix: "" },
		{ baseFilename: "doc.pdf", existing: ["doc.pdf"], expectedSuffix: "_1" },
		{ baseFilename: "doc.pdf", existing: ["doc.pdf", "doc_1.pdf"], expectedSuffix: "_2" },
		{ baseFilename: "image.png", existing: ["image.png", "image_1.png"], expectedSuffix: "_2" },
		{ baseFilename: "noext", existing: ["noext"], expectedSuffix: "_1" },
		{ baseFilename: "file.name.pdf", existing: ["file.name.pdf"], expectedSuffix: "_1" },
	])(
		"$baseFilename with existing $existing -> stem$expectedSuffix suffix",
		({ baseFilename, existing, expectedSuffix }) =>
			Effect.gen(function* () {
				const tmp = yield* createTestTempDirEffect();
				for (const name of existing) {
					yield* tmp.writeFile(tmp.join(name), "");
				}
				const result = yield* resolveOutputPath(tmp.path, baseFilename);
				const idx = expectedSuffix === "" ? 0 : Number.parseInt(expectedSuffix.slice(1), 10);
				const { stem, suffix } = splitFilenameForCollision(baseFilename);
				const expectedName =
					idx === 0 ? baseFilename : collisionCandidateFilename(stem, suffix, idx);
				assert.strictEqual(result, tmp.join(expectedName));
				yield* tmp.remove();
			}),
	);

	it.effect("PBT: path never collides with pre-existing files", () =>
		Effect.gen(function* () {
			const baseFilenameArb = fc
				.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,29}$/)
				.filter((s) => s !== "." && s !== "..");
			const countArb = fc.integer({ min: 0, max: 10 });
			yield* Effect.promise(() =>
				fc.assert(
					fc.asyncProperty(baseFilenameArb, countArb, async (baseFilename, existingCount) => {
						const tmp = await createTestTempDir();
						const { stem, suffix } = splitFilenameForCollision(baseFilename);
						for (let i = 0; i < existingCount; i++) {
							const name = i === 0 ? baseFilename : collisionCandidateFilename(stem, suffix, i);
							await tmp.writeFile(tmp.join(name), "");
						}
						const program = Effect.gen(function* () {
							return yield* resolveOutputPath(tmp.path, baseFilename);
						}).pipe(Effect.provide(ResolveOutputPathLayer)) as Effect.Effect<string, never, never>;
						const result = await Effect.runPromise(program);
						expect(await pathExists(result)).toBe(false);
						expect(result).toContain(tmp.path);
						await tmp.remove();
					}),
				),
			);
		}),
	);
});
