/**
 * Email attachment handling — fetch, eligibility, save.
 * Retry logic, Ollama assessment, path resolution.
 */

import type { Schedule } from "effect";
import { Effect, FileSystem, Option, Result } from "effect";
import * as Arr from "effect/Array";
import { sumAll } from "effect/Number";
import {
	attachmentBaseFilename,
	buildOllamaRequest,
	isEmailAttachmentEligible,
} from "../core/index.js";
import type { ImapSearchQuery } from "../core/search.js";
import type { Account } from "../domain/account.js";
import { formatErrorForStructuredLog } from "../domain/errors.js";
import type { AppEffect, MessageUid } from "../domain/types.js";
import type { EmailSession, RawAttachment } from "../interfaces/email-client.js";
import type { OllamaRequest } from "../interfaces/ollama-client.js";
import { OllamaClient } from "../live/ollama-client.js";
import { EmailConfig } from "./config.js";
import { mapFsError, resolveOutputPath } from "./fs-utils.js";

/** Max attachment size for IMAP fetch (25 MiB). Exported for tests. */
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

/** Attachment ready to save (eligible, path resolved). */
export interface AttachmentToSave {
	readonly path: string;
	readonly data: Uint8Array;
	readonly ollamaReq: OllamaRequest | null;
	readonly messageUid: MessageUid;
}

/** Result from processing a single page. */
interface PageResult {
	readonly saved: number;
	readonly labeledUids: readonly MessageUid[];
}

/** Fetch UIDs with retry; on failure log and return []. Exported for testing. */
export function fetchUidsWithRetry(
	session: EmailSession,
	searchQuery: ImapSearchQuery,
	acc: Account,
	retrySchedule: Schedule.Schedule<unknown>,
): AppEffect<readonly MessageUid[]> {
	return session.search(searchQuery).pipe(
		Effect.retry({ schedule: retrySchedule }),
		Effect.catch((e) =>
			Effect.gen(function* () {
				yield* Effect.logError({
					event: "imap_search",
					status: "failed",
					email: acc.email,
					error: formatErrorForStructuredLog(e),
				});
				return [] as MessageUid[];
			}),
		),
	);
}

/** Fetch attachments with retry; on failure log and return []. Exported for testing. */
export function fetchAttachmentsWithRetry(
	session: EmailSession,
	pageUids: readonly MessageUid[],
	acc: Account,
	retrySchedule: Schedule.Schedule<unknown>,
): AppEffect<readonly RawAttachment[]> {
	return session.fetchAttachmentsForUids(pageUids, MAX_ATTACHMENT_SIZE).pipe(
		Effect.retry({ schedule: retrySchedule }),
		Effect.catch((e) =>
			Effect.gen(function* () {
				yield* Effect.logError({
					event: "imap_fetch_attachments",
					status: "failed",
					email: acc.email,
					error: formatErrorForStructuredLog(e),
				});
				return [] as const;
			}),
		),
	);
}

const processItem = Effect.fn("saveEligibleAttachmentsItem")(function* (item: AttachmentToSave) {
	const fs = yield* FileSystem.FileSystem;
	const ollama = yield* OllamaClient;
	const accepted = yield* Option.match(Option.fromNullishOr(item.ollamaReq), {
		onNone: () => Effect.succeed(true),
		onSome: (req) => ollama.assess(req).pipe(Effect.orElseSucceed(() => true)),
	});
	if (!accepted) return { saved: 0 as const, messageUid: undefined as MessageUid | undefined };
	yield* fs.writeFile(item.path, item.data).pipe(mapFsError(item.path, "writeFile"));
	return { saved: 1 as const, messageUid: item.messageUid };
});

/** Process and save eligible attachments; return saved count and labeled UIDs. Exported for testing. */
export const saveEligibleAttachments = Effect.fn("saveEligibleAttachments")(function* (
	toSave: readonly AttachmentToSave[],
) {
	const results = yield* Effect.forEach(toSave, processItem);
	const saved = sumAll(results.map((r) => r.saved));
	const labeledUids = Arr.filterMap(results, (r) =>
		r.messageUid !== undefined ? Result.succeed(r.messageUid) : Result.failVoid,
	);
	return { saved, labeledUids } satisfies PageResult;
});

/** Process single raw attachment: check eligibility, build Ollama req, resolve path. Exported for testing. */
export const processRawAttachment = Effect.fn("processRawAttachment")(function* (
	raw: RawAttachment,
	i: number,
	emailSubdir: string,
) {
	if (!raw) return null;
	const config = yield* EmailConfig;
	const fs = yield* FileSystem.FileSystem;
	return yield* Result.match(isEmailAttachmentEligible(raw.contentType, raw.filename, raw.size), {
		onFailure: () => Effect.succeed(null),
		onSuccess: () =>
			Effect.gen(function* () {
				const data = raw.path
					? yield* fs
							.readFile(raw.path)
							.pipe(
								mapFsError(raw.path, "readFile"),
								Effect.ensuring(fs.remove(raw.path).pipe(Effect.catch(() => Effect.void))),
							)
					: raw.data;
				const ollamaReq = Option.getOrNull(
					buildOllamaRequest(
						data,
						raw.contentType,
						config.ollamaVisionModel,
						config.ollamaTextModel,
					),
				);
				const fullBase = attachmentBaseFilename(raw.filename, raw.contentType, i);
				const outPath = yield* resolveOutputPath(emailSubdir, fullBase);
				return {
					path: outPath,
					data,
					ollamaReq,
					messageUid: raw.messageUid,
				} satisfies AttachmentToSave;
			}),
	});
});

/** Collect eligible attachments from raw; filter nulls. */
export const collectEligibleAttachments = Effect.fn("collectEligibleAttachments")(function* (
	rawAttachments: readonly RawAttachment[],
	emailSubdir: string,
) {
	const results = yield* Effect.forEach(rawAttachments, (raw, i) =>
		processRawAttachment(raw, i, emailSubdir),
	);
	return Arr.filter(results, (r): r is AttachmentToSave => r !== null);
});
