import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import type { ImapFlow } from "imapflow";
import type { MessageUid } from "../src/domain/types.js";
import { fetchAttachmentsForUidsEffect } from "../src/live/imap-email-client.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import { createTestAccount } from "./fixtures/account.js";
import { readTestFile, SilentLoggerLayer } from "./test-utils.js";

const ImapClientTestLayer = Layer.mergeAll(PlatformServicesLayer, SilentLoggerLayer);

/** Mock ImapFlow that returns fixed body structure and streams bytes to temp. */
function createMockClient(
	attachments: { partId: string; contentType: string; filename?: string; content: Uint8Array }[],
): ImapFlow {
	const contentIter = (data: Uint8Array) => ({
		[Symbol.asyncIterator]: async function* () {
			yield data;
		},
	});

	return {
		mailboxOpen: async () => {},
		fetchOne: async (_uid: number, opts?: { bodyStructure?: boolean }) => {
			if (opts?.bodyStructure) {
				const parts = attachments.map((a) => ({
					partId: a.partId,
					type: a.contentType,
					disposition: "attachment" as const,
					dispositionParameters: a.filename ? { filename: a.filename } : undefined,
					size: a.content.length,
					childNodes: undefined,
				}));
				return { bodyStructure: { type: "multipart", childNodes: parts } };
			}
			return false;
		},
		download: async (_uid: number, partId: string) => {
			const att = attachments.find((a) => a.partId === partId);
			return att
				? { content: contentIter(att.content) as AsyncIterable<Uint8Array> }
				: { content: contentIter(new Uint8Array(0)) as AsyncIterable<Uint8Array> };
		},
	} as unknown as ImapFlow;
}

layer(ImapClientTestLayer)("imap-email-client", (it) => {
	it.effect("fetchAttachmentsForUidsEffect returns attachments streamed to temp files", () =>
		Effect.gen(function* () {
			const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
			const client = createMockClient([
				{
					partId: "1.1",
					contentType: "application/pdf",
					filename: "doc.pdf",
					content: pdfData,
				},
			]);
			const account = createTestAccount("test@example.com");

			const result = yield* fetchAttachmentsForUidsEffect(
				account,
				client,
				[1] as MessageUid[],
				10 * 1024 * 1024,
			);

			const first = result[0];
			assert.ok(first);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(first.contentType, "application/pdf");
			assert.strictEqual(first.filename, "doc.pdf");
			assert.strictEqual(first.messageUid, 1);
			assert.ok(first.path);
			assert.strictEqual(first.data.length, 0);

			const path = first.path;
			assert.ok(path);
			const fileContent = yield* Effect.promise(() => readTestFile(path));
			assert.deepStrictEqual(fileContent, pdfData);

			const fs = yield* FileSystem.FileSystem;
			yield* fs.remove(path).pipe(Effect.catch(() => Effect.void));
		}),
	);

	it.effect("fetchAttachmentsForUidsEffect skips attachments over maxSize", () =>
		Effect.gen(function* () {
			const largeData = new Uint8Array(100);
			const client = createMockClient([
				{
					partId: "1.1",
					contentType: "application/pdf",
					filename: "big.pdf",
					content: largeData,
				},
			]);
			const account = createTestAccount("test@example.com");

			const result = yield* fetchAttachmentsForUidsEffect(account, client, [1] as MessageUid[], 50);

			assert.strictEqual(result.length, 0);
		}),
	);

	it.effect("fetchAttachmentsForUidsEffect returns empty for empty uids", () =>
		Effect.gen(function* () {
			const client = createMockClient([]);
			const account = createTestAccount("test@example.com");

			const result = yield* fetchAttachmentsForUidsEffect(account, client, [], 1024);

			assert.strictEqual(result.length, 0);
		}),
	);
});
