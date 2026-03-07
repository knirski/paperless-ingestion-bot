/**
 * FS error mapping helpers and path resolution for shell code.
 */

import { Effect, FileSystem, Path } from "effect";
import { collisionCandidateFilename, splitFilenameForCollision } from "../core/filename.js";
import { wrapFs } from "../domain/errors.js";
/** Pipe helper: mapEffect.pipe(mapFsError(path, op)) instead of .pipe(Effect.mapError(wrapFs(path, op))). */
export function mapFsError(path: string, op: string) {
	return <A, E, R>(eff: Effect.Effect<A, E, R>) => eff.pipe(Effect.mapError(wrapFs(path, op)));
}

/** Resolve output path with collision handling via Effect FileSystem. */
export const resolveOutputPath = Effect.fn("resolveOutputPath")(function* (
	dir: string,
	baseFilename: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const pathApi = yield* Path.Path;
	let outPath = pathApi.join(dir, baseFilename);
	let idx = 0;
	const { stem, suffix } = splitFilenameForCollision(baseFilename);
	while (yield* fs.exists(outPath).pipe(mapFsError(outPath, "exists"))) {
		idx++;
		outPath = pathApi.join(dir, collisionCandidateFilename(stem, suffix, idx));
	}
	return outPath;
});
