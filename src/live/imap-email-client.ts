/**
 * Live EmailClient interpreter — imapflow for IMAP (Gmail and generic).
 *
 * Gmail: imap.gmail.com, [Gmail]/All Mail, X-GM-RAW search, labels.
 * Generic: configurable host/port/mailbox, standard search, flags.
 */

import {
	Effect,
	FileSystem,
	Layer,
	Path,
	Random,
	Redacted,
	Ref,
	Semaphore,
	ServiceMap,
	Stream,
} from "effect";
import * as Arr from "effect/Array";
import { ImapFlow } from "imapflow";
import { collectAttachmentParts } from "../core/imap-body-structure.js";
import type { ImapSearchQuery } from "../core/search.js";
import type { Account } from "../domain/account.js";
import { ImapConnectionError } from "../domain/errors.js";
import type { AppEffect, EmailLabel, MessageUid } from "../domain/types.js";
import { redactEmail, redactedForLog, unknownToMessage } from "../domain/utils.js";
import type {
	EmailClientService,
	EmailSession,
	RawImapAttachment,
} from "../interfaces/email-client.js";

export class EmailClient extends ServiceMap.Service<EmailClient, EmailClientService>()(
	"paperless-ingestion-bot/live/imap-email-client",
) {
	static readonly live = (() => {
		const layer = Layer.effect(EmailClient)(
			Effect.gen(function* () {
				const cache = yield* Ref.make(new Map<string, ImapFlow>());
				const acquireLock = yield* Semaphore.make(1);
				return EmailClient.of({
					withConnection: Effect.fn(
						"paperless-ingestion-bot/live/imap-email-client.withConnection",
					)(function* (account, fn) {
						return yield* Effect.scoped(
							acquireLock.withPermits(1)(
								Effect.gen(function* () {
									const existing = yield* Ref.get(cache).pipe(
										Effect.map((m) => m.get(account.email)),
									);
									const client = existing ?? (yield* acquireConnection(account));
									if (!existing) {
										yield* Ref.update(cache, (m) => new Map(m).set(account.email, client));
									}
									return yield* fn(createSession(client, account));
								}),
							),
						);
					}),
				});
			}),
		);
		return layer;
	})();
}

function connectClient(account: Account): ImapFlow {
	const config = account.imapConfig;
	return new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: { user: account.email, pass: Redacted.value(account.appPassword) },
	});
}

function toImapError(account: Account, e: unknown): ImapConnectionError {
	return new ImapConnectionError({
		email: redactedForLog(account.email, redactEmail),
		message: unknownToMessage(e),
	});
}

function imap<T>(account: Account, try_: () => Promise<T>) {
	return Effect.fn("paperless-ingestion-bot/live/imap-email-client.imap")(function* () {
		return yield* Effect.tryPromise({ try: try_, catch: (e) => toImapError(account, e) });
	})();
}

async function openMailbox(client: ImapFlow, mailbox: string, readOnly: boolean): Promise<void> {
	try {
		await client.mailboxOpen(mailbox, { readOnly });
	} catch {
		await client.mailboxOpen("INBOX", { readOnly });
	}
}

const INGESTION_TEMP_PREFIX = "paperless-ingestion-";

/** Stream download content to temp file. Returns path and size. Uses fs.sink to avoid buffering large attachments in memory. */
const streamToTempFile = Effect.fn(
	"paperless-ingestion-bot/live/imap-email-client.streamToTempFile",
)(function* (account: Account, content: AsyncIterable<Uint8Array>) {
	const fs = yield* FileSystem.FileSystem;
	const pathApi = yield* Path.Path;
	const uuid = yield* Random.nextUUIDv4;
	const baseDir = yield* imap(account, () =>
		Effect.runPromise(fs.makeTempDirectory({ prefix: INGESTION_TEMP_PREFIX })),
	);
	const filePath = pathApi.join(baseDir, `${uuid}.tmp`);
	yield* imap(account, () =>
		Effect.runPromise(
			Stream.run(
				Stream.fromAsyncIterable(content, (e) => e),
				fs.sink(filePath),
			),
		),
	);
	const stat = yield* imap(account, () => Effect.runPromise(fs.stat(filePath)));
	return { path: filePath, size: Number(stat.size) };
});

/** Fetch one attachment part. Returns null if over maxSize. Streams to temp file to avoid buffering. */
const fetchPart = Effect.fn("paperless-ingestion-bot/live/imap-email-client.fetchPart")(function* (
	account: Account,
	client: ImapFlow,
	uid: number,
	part: { partId: string; contentType: string; filename: string | undefined; size: number },
	maxSize: number,
	labels: readonly EmailLabel[],
) {
	const fs = yield* FileSystem.FileSystem;
	const downloadObj = yield* imap(account, () => client.download(uid, part.partId, { uid: true }));
	const { path, size } = yield* streamToTempFile(account, downloadObj.content);
	if (size > maxSize) {
		yield* imap(account, () =>
			Effect.runPromise(
				fs
					.remove(path)
					.pipe(
						Effect.ignore({ log: "Warn", message: "Temp file cleanup failed after size check" }),
					),
			),
		);
		return null;
	}
	return {
		contentType: part.contentType,
		filename: part.filename,
		size,
		data: new Uint8Array(0),
		messageUid: uid as MessageUid,
		path,
		labels,
	};
});

/** Fetch attachment parts for UIDs. Effect-based; exported for testing. */
export const fetchAttachmentsForUidsEffect = (
	account: Account,
	client: ImapFlow,
	uids: readonly MessageUid[],
	maxSize: number,
): Effect.Effect<
	readonly RawImapAttachment[],
	ImapConnectionError,
	FileSystem.FileSystem | Path.Path
> =>
	Effect.gen(function* () {
		if (uids.length === 0) return [];
		const { mailbox } = account.imapConfig;
		yield* imap(account, () => openMailbox(client, mailbox, true));

		const requestLabels = account.imapConfig.provider === "gmail";
		const perUid = yield* Effect.forEach(uids, (uid: MessageUid) =>
			Effect.gen(function* () {
				const fetchQuery = requestLabels
					? { bodyStructure: true, labels: true }
					: { bodyStructure: true };
				const full = yield* imap(account, () =>
					client.fetchOne(uid as number, fetchQuery, { uid: true }),
				);
				if (full === false || !full.bodyStructure) return [];
				const labels: EmailLabel[] =
					requestLabels && full.labels ? [...full.labels].map((l) => l as EmailLabel) : [];
				const parts = collectAttachmentParts(full.bodyStructure);
				return yield* Effect.forEach(parts, (part) =>
					fetchPart(account, client, uid as number, part, maxSize, labels),
				);
			}),
		);

		const flattened = Arr.flatten(perUid);
		return Arr.filter(
			flattened,
			(a): a is NonNullable<typeof a> => a !== null,
		) as readonly RawImapAttachment[];
	});

function createSession(client: ImapFlow, account: Account): EmailSession {
	const imapConfig = account.imapConfig;

	return {
		search: (query: ImapSearchQuery) =>
			Effect.gen(function* () {
				yield* imap(account, () => openMailbox(client, imapConfig.mailbox, true));
				const list = yield* imap(account, () => client.search(query, { uid: true }));
				const uids = (list === false ? [] : list) as MessageUid[];
				return uids;
			}),

		fetchAttachmentsForUids: (uids, maxSize) =>
			// Cast: EmailSession declares AppEffect (no FileSystem/Path) but implementation requires them; caller provides layers.
			fetchAttachmentsForUidsEffect(account, client, uids, maxSize) as AppEffect<
				readonly RawImapAttachment[]
			>,

		markProcessed: (uids, value) =>
			Effect.gen(function* () {
				if (uids.length === 0) return;
				yield* imap(account, () => openMailbox(client, imapConfig.mailbox, false));
				if (imapConfig.markProcessedStrategy === "label") {
					// Gmail: label may already exist; ignore create failure
					yield* imap(account, () => client.mailboxCreate(value)).pipe(
						Effect.catch(() => Effect.void),
					);
					yield* imap(account, () =>
						client.messageFlagsAdd([...uids] as number[], [value], {
							uid: true,
							useLabels: true,
						}),
					);
				} else {
					yield* imap(account, () =>
						client.messageFlagsAdd([...uids] as number[], [value], {
							uid: true,
							useLabels: false,
						}),
					);
				}
			}),
	};
}

/** Acquire IMAP connection with release on scope end. Ensures connections are closed when layer is torn down. */
function acquireConnection(account: Account) {
	return Effect.acquireRelease(
		imap(account, async () => {
			const c = connectClient(account);
			await c.connect();
			return c;
		}),
		(client) =>
			Effect.tryPromise(() => client.logout()).pipe(
				Effect.ignoreCause({
					log: "Debug",
					message: "IMAP logout failed (connection may already be closed)",
				}),
			),
	);
}

/** Connection pool: one cached connection per account. Reuses connections across withConnection calls.
 * Uses Effect.acquireRelease so connections are closed when the layer is torn down. */
export const EmailClientLive = EmailClient.live;
