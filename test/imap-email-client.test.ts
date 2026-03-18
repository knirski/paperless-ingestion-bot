import { describe, expect, test } from "bun:test";
import { Effect, FileSystem, Layer } from "effect";
import type { ImapFlow } from "imapflow";
import type { MessageUid } from "../src/domain/types.js";
import { fetchAttachmentsForUidsEffect } from "../src/live/imap-email-client.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import { createTestAccount } from "./fixtures/account.js";
import { readTestFile, runWithLayer, SilentLoggerLayer } from "./test-utils.js";

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

const run = runWithLayer(ImapClientTestLayer);

describe("imap-email-client", () => {
	test("fetchAttachmentsForUidsEffect returns attachments streamed to temp files", async () => {
		await run(
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
				expect(first).toBeDefined();
				expect(result.length).toBe(1);
				expect(first?.contentType).toBe("application/pdf");
				expect(first?.filename).toBe("doc.pdf");
				expect(first?.messageUid).toBe(1 as import("../src/domain/types.js").MessageUid);
				expect(first?.path).toBeDefined();
				expect(first?.data.length).toBe(0);

				const path = first?.path;
				expect(path).toBeDefined();
				if (!path) throw new Error("path expected");
				const fileContent = yield* Effect.promise(() => readTestFile(path));
				expect(fileContent).toEqual(pdfData);

				const fs = yield* FileSystem.FileSystem;
				yield* fs.remove(path).pipe(Effect.catch(() => Effect.void));
			}),
		);
	});

	test("fetchAttachmentsForUidsEffect skips attachments over maxSize", async () => {
		await run(
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

				const result = yield* fetchAttachmentsForUidsEffect(
					account,
					client,
					[1] as MessageUid[],
					50,
				);

				expect(result.length).toBe(0);
			}),
		);
	});

	test("fetchAttachmentsForUidsEffect returns empty for empty uids", async () => {
		await run(
			Effect.gen(function* () {
				const client = createMockClient([]);
				const account = createTestAccount("test@example.com");

				const result = yield* fetchAttachmentsForUidsEffect(account, client, [], 1024);

				expect(result.length).toBe(0);
			}),
		);
	});
});
