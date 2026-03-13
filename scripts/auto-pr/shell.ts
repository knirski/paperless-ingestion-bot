/**
 * Shared shell (Effect) for auto-PR scripts. I/O, exec, layers.
 * Uses Effect-native ChildProcessSpawner from effect/unstable/process.
 */

import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { formatGhOutput } from "./core.js";
import { GhPrFailed } from "./errors.js";

/** Platform layer for auto-PR scripts: FileSystem + Path. */
export const AutoPrPlatformLayer = NodeFileSystem.layer.pipe(Layer.provideMerge(NodePath.layer));

/** ChildProcessSpawner layer (requires FileSystem + Path). */
export const ChildProcessSpawnerLayer = NodeChildProcessSpawner.layer.pipe(
	Layer.provide(AutoPrPlatformLayer),
);

/** Run a command and return stdout. Maps PlatformError to GhPrFailed. */
export function runCommand(
	command: string,
	args: string[],
	cwd: string,
): Effect.Effect<string, GhPrFailed, ChildProcessSpawner> {
	return Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		return yield* spawner
			.string(ChildProcess.make(command, args, { cwd }))
			.pipe(Effect.mapError((e) => new GhPrFailed({ cause: String(e) })));
	});
}

/** Append entries to GITHUB_OUTPUT file. */
export function appendGhOutput(
	path: string,
	entries: ReadonlyArray<{ key: string; value: string }>,
): Effect.Effect<void, Error, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const content = formatGhOutput(entries);
		yield* fs.writeFileString(path, content, { flag: "a" });
	});
}
