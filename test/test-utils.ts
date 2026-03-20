import { Effect, FileSystem, Layer, Logger, Path } from "effect";
import { PlatformServicesLayer } from "../src/shell/layers.js";

export const SilentLoggerLayer = Logger.layer([]);
export const TestBaseLayer = Layer.mergeAll(SilentLoggerLayer, PlatformServicesLayer);

/** Effect-based temp dir for use with layer() / it.effect. */
export const createTestTempDirEffect = (prefix = "ingestion-bot-") =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pathApi = yield* Path.Path;
		const tmpDir = yield* fs.makeTempDirectory({ prefix });
		return {
			path: tmpDir,
			join: (...s: string[]) => pathApi.join(tmpDir, ...s),
			writeFile: (filePath: string, content: string | Uint8Array) =>
				typeof content === "string"
					? fs.writeFileString(filePath, content)
					: fs.writeFile(filePath, content),
			remove: () => fs.remove(tmpDir, { recursive: true }).pipe(Effect.catch(() => Effect.void)),
		};
	});

/** Create a temp dir for tests. Returns path, join helper, writeFile, and remove. */
export async function createTestTempDir(prefix = "ingestion-bot-"): Promise<{
	path: string;
	join: (...segments: string[]) => string;
	writeFile: (filePath: string, content: string | Uint8Array) => Promise<void>;
	remove: () => Promise<void>;
}> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const pathApi = yield* Path.Path;
			const tmpDir = yield* fs.makeTempDirectory({ prefix });
			return {
				path: tmpDir,
				join: (...s: string[]) => pathApi.join(tmpDir, ...s),
				writeFile: (filePath: string, content: string | Uint8Array) =>
					Effect.runPromise(
						(typeof content === "string"
							? fs.writeFileString(filePath, content)
							: fs.writeFile(filePath, content)
						).pipe(Effect.provide(PlatformServicesLayer)),
					),
				remove: () =>
					Effect.runPromise(
						fs.remove(tmpDir, { recursive: true }).pipe(
							Effect.catch(() => Effect.void),
							Effect.provide(PlatformServicesLayer),
						),
					),
			};
		}).pipe(Effect.provide(PlatformServicesLayer)),
	);
}

/** Check if a path exists (for assertions). */
export async function pathExists(filePath: string): Promise<boolean> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return yield* fs.exists(filePath);
		}).pipe(Effect.provide(PlatformServicesLayer)),
	);
}

/** Join path segments using Effect Path service. */
export async function joinPath(...segments: string[]): Promise<string> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const path = yield* Path.Path;
			return path.join(...segments);
		}).pipe(Effect.provide(PlatformServicesLayer)),
	);
}

/** Write file at path using Effect FileSystem. */
export async function writeTestFile(path: string, content: string | Uint8Array): Promise<void> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			if (typeof content === "string") {
				yield* fs.writeFileString(path, content);
			} else {
				yield* fs.writeFile(path, content);
			}
		}).pipe(Effect.provide(PlatformServicesLayer)),
	);
}

/** Read file at path using Effect FileSystem. */
export async function readTestFile(path: string, encoding?: "utf-8"): Promise<string | Uint8Array> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			if (encoding === "utf-8") {
				return yield* fs.readFileString(path);
			}
			return yield* fs.readFile(path);
		}).pipe(Effect.provide(PlatformServicesLayer)),
	);
}

/** Run an Effect with the given layer. Use instead of @effect/vitest layer() helper. */
export function runWithLayer<R>(layer: Layer.Layer<R>) {
	return <E, A>(effect: Effect.Effect<A, E, R>): Promise<A> =>
		Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

export { emailConfigTest, signalConfigTest } from "./fixtures/config.js";
export { credentialsStoreTest } from "./fixtures/credentials.js";
