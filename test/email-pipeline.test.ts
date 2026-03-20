import { describe, expect, it, test } from "bun:test";
import { Effect, Layer } from "effect";
import * as Http from "effect/unstable/http";
import type { ImapSearchQuery } from "../src/core/search.js";
import { type TagName, toTagName } from "../src/domain/paperless-types.js";
import type { AppEffect, EmailLabel, MessageUid } from "../src/domain/types.js";
import type { RawImapAttachment } from "../src/interfaces/email-client.js";
import type { OllamaClientService } from "../src/interfaces/ollama-client.js";
import { EmailClient } from "../src/live/imap-email-client.js";
import { OllamaClient } from "../src/live/ollama-client.js";
import { PaperlessClient } from "../src/live/paperless-client.js";
import { processRawAttachment } from "../src/shell/email-attachments.js";
import {
	type AttachmentToSave,
	runEmailPipeline,
	saveEligibleAttachments,
} from "../src/shell/email-pipeline.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import {
	createTestTempDir,
	credentialsStoreTest,
	emailConfigTest,
	pathExists,
	SilentLoggerLayer,
	TestBaseLayer,
} from "./test-utils.js";

const emptyImapLayer = Layer.succeed(EmailClient)(
	EmailClient.of({
		withConnection: (_account, fn) =>
			fn({
				search: () => Effect.succeed([] as const),
				fetchAttachmentsForUids: () => Effect.succeed([] as const),
				markProcessed: () => Effect.void,
			}),
	}),
);

/** Mock OllamaClient that always returns true (accept) for document assessment. */
const alwaysAcceptOllamaLayer = Layer.succeed(OllamaClient)(
	OllamaClient.of({
		assess: () => Effect.succeed(true),
	}),
);

describe("email-pipeline", () => {
	it("runEmailPipeline with empty EmailClient returns saved: 0", async () => {
		const tmp = await createTestTempDir();
		const emailAccountsPath = tmp.join("email-accounts.json");
		const layer = Layer.mergeAll(
			PlatformServicesLayer,
			Http.FetchHttpClient.layer,
			emailConfigTest({ emailAccountsPath }),
			credentialsStoreTest({}),
			emptyImapLayer,
			alwaysAcceptOllamaLayer,
		);
		const result = await Effect.runPromise(
			runEmailPipeline().pipe(
				Effect.provide(layer),
				Effect.provide(SilentLoggerLayer),
			) as AppEffect<{ saved: number }>,
		);
		expect(result).toEqual({ saved: 0 });
		await tmp.remove();
	});

	test("search query merges defaults, user exclude labels, and paperless", async () => {
		const tmp = await createTestTempDir();
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(
			emailAccountsPath,
			JSON.stringify([
				{
					email: "test@example.com",
					enabled: true,
					removed: false,
					exclude_labels: ["Archived", "Newsletters"],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]),
		);

		const capturedQueries: ImapSearchQuery[] = [];
		const imapLayer = Layer.succeed(EmailClient)(
			EmailClient.of({
				withConnection: (_account, fn) =>
					fn({
						search: (query) => {
							capturedQueries.push(query);
							return Effect.succeed([] as const);
						},
						fetchAttachmentsForUids: () => Effect.succeed([] as const),
						markProcessed: () => Effect.void,
					}),
			}),
		);

		const layer = Layer.mergeAll(
			PlatformServicesLayer,
			Http.FetchHttpClient.layer,
			emailConfigTest({
				emailAccountsPath,
				markProcessedLabel: "paperless" as EmailLabel,
			}),
			credentialsStoreTest({ "test@example.com": "abcdefghijklmnop" }),
			imapLayer,
			alwaysAcceptOllamaLayer,
		);

		await Effect.runPromise(
			runEmailPipeline().pipe(
				Effect.provide(layer),
				Effect.provide(SilentLoggerLayer),
			) as AppEffect<{ saved: number }>,
		);

		expect(capturedQueries).toHaveLength(1);
		const q = capturedQueries[0];
		if (!q) throw new Error("expected one captured query");
		expect("gmraw" in q && q.gmraw).toBeTruthy();
		const gmraw = "gmraw" in q ? q.gmraw : "";
		expect(gmraw).toContain("-category:promotions");
		expect(gmraw).toContain("-category:social");
		expect(gmraw).toContain("-label:SPAM");
		expect(gmraw).toContain("-label:TRASH");
		expect(gmraw).toContain("-label:Archived");
		expect(gmraw).toContain("-label:Newsletters");
		expect(gmraw).toContain("-label:paperless");
		await tmp.remove();
	});

	test("search query deduplicates when user exclude overlaps with defaults", async () => {
		const tmp = await createTestTempDir();
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(
			emailAccountsPath,
			JSON.stringify([
				{
					email: "test@example.com",
					enabled: true,
					removed: false,
					exclude_labels: ["SPAM"],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]),
		);

		const capturedQueries: ImapSearchQuery[] = [];
		const imapLayer = Layer.succeed(EmailClient)(
			EmailClient.of({
				withConnection: (_account, fn) =>
					fn({
						search: (query) => {
							capturedQueries.push(query);
							return Effect.succeed([] as const);
						},
						fetchAttachmentsForUids: () => Effect.succeed([] as const),
						markProcessed: () => Effect.void,
					}),
			}),
		);

		const layer = Layer.mergeAll(
			PlatformServicesLayer,
			Http.FetchHttpClient.layer,
			emailConfigTest({
				emailAccountsPath,
				markProcessedLabel: "paperless" as EmailLabel,
			}),
			credentialsStoreTest({ "test@example.com": "abcdefghijklmnop" }),
			imapLayer,
			alwaysAcceptOllamaLayer,
		);

		await Effect.runPromise(
			runEmailPipeline().pipe(
				Effect.provide(layer),
				Effect.provide(SilentLoggerLayer),
			) as AppEffect<{ saved: number }>,
		);

		expect(capturedQueries).toHaveLength(1);
		const q = capturedQueries[0];
		const gmraw = q !== undefined && "gmraw" in q ? q.gmraw : "";
		const spamCount = (gmraw.match(/-label:SPAM/g) ?? []).length;
		expect(spamCount).toBe(1);
		await tmp.remove();
	});
});

describe("saveEligibleAttachments", () => {
	const mockPaperlessLayer = (mock: {
		uploadDocument: (
			data: Uint8Array,
			filename: string,
			tags: readonly TagName[],
		) => AppEffect<void>;
	}) => Layer.succeed(PaperlessClient)(mock as never);
	const mockOllamaLayer = (mockOllama: OllamaClientService) =>
		Layer.succeed(OllamaClient)(mockOllama);

	test("empty toSave returns saved: 0, labeledUids: []", async () => {
		const mockPaperless = {
			uploadDocument: () => Effect.void,
		};
		const mockOllama = {
			assess: () => Effect.succeed(true),
		} as unknown as OllamaClientService;
		const result = await Effect.runPromise(
			saveEligibleAttachments([]).pipe(
				Effect.provide(mockPaperlessLayer(mockPaperless)),
				Effect.provide(mockOllamaLayer(mockOllama)),
			),
		);
		expect(result).toEqual({ saved: 0, labeledUids: [] });
	});

	test("item with ollamaReq: false rejects, not saved", async () => {
		const assessCalls: unknown[] = [];
		const mockOllama = {
			assess: (req: unknown) => {
				assessCalls.push(req);
				return Effect.succeed(false);
			},
		} as unknown as OllamaClientService;
		const toSave: AttachmentToSave[] = [
			{
				filename: "out.pdf",
				data: new Uint8Array([1, 2, 3]),
				ollamaReq: { model: "x", prompt: "y", stream: false },
				messageUid: 42 as MessageUid,
				emailSlug: "test-example-com",
				labels: [],
			},
		];
		const result = await Effect.runPromise(
			saveEligibleAttachments(toSave).pipe(
				Effect.provide(mockPaperlessLayer({ uploadDocument: () => Effect.void })),
				Effect.provide(mockOllamaLayer(mockOllama)),
			),
		);
		expect(result.saved).toBe(0);
		expect(result.labeledUids).toEqual([]);
		expect(assessCalls.length).toBe(1);
	});

	test("item with ollamaReq: true accepts, saved", async () => {
		let uploadedFilename: string | undefined;
		let uploadedData: Uint8Array | undefined;
		let uploadedTags: readonly TagName[] | undefined;
		const mockPaperless = {
			uploadDocument: (data: Uint8Array, filename: string, tags: readonly TagName[]) => {
				uploadedFilename = filename;
				uploadedData = data;
				uploadedTags = tags;
				return Effect.void;
			},
		};
		const mockOllama = {
			assess: () => Effect.succeed(true),
		} as unknown as OllamaClientService;
		const toSave: AttachmentToSave[] = [
			{
				filename: "out.pdf",
				data: new Uint8Array([1, 2, 3]),
				ollamaReq: { model: "x", prompt: "y", stream: false },
				messageUid: 42 as MessageUid,
				emailSlug: "test-example-com",
				labels: [],
			},
		];
		const result = await Effect.runPromise(
			saveEligibleAttachments(toSave).pipe(
				Effect.provide(mockPaperlessLayer(mockPaperless)),
				Effect.provide(mockOllamaLayer(mockOllama)),
			),
		);
		expect(result.saved).toBe(1);
		expect(result.labeledUids).toEqual([42 as MessageUid]);
		expect(uploadedFilename).toBe("out.pdf");
		expect(uploadedData).toEqual(new Uint8Array([1, 2, 3]));
		expect(uploadedTags).toEqual([toTagName("email"), toTagName("test-example-com")]);
	});

	test("item with labels adds sanitized labels to tags", async () => {
		let uploadedTags: readonly TagName[] | undefined;
		const mockPaperless = {
			uploadDocument: (_data: Uint8Array, _filename: string, tags: readonly TagName[]) => {
				uploadedTags = tags;
				return Effect.void;
			},
		};
		const mockOllama = {
			assess: () => Effect.succeed(true),
		} as unknown as OllamaClientService;
		const toSave: AttachmentToSave[] = [
			{
				filename: "doc.pdf",
				data: new Uint8Array([1, 2, 3]),
				ollamaReq: null,
				messageUid: 1 as MessageUid,
				emailSlug: "test-example-com",
				labels: ["category:promotions", "INBOX"] as EmailLabel[],
			},
		];
		await Effect.runPromise(
			saveEligibleAttachments(toSave).pipe(
				Effect.provide(mockPaperlessLayer(mockPaperless)),
				Effect.provide(mockOllamaLayer(mockOllama)),
			),
		);
		expect(uploadedTags).toContain(toTagName("email"));
		expect(uploadedTags).toContain(toTagName("test-example-com"));
		expect(uploadedTags).toContain(toTagName("gmail-category-promotions"));
		expect(uploadedTags).not.toContain(toTagName("inbox"));
	});
});

describe("processRawAttachment", () => {
	it("reads from path when raw.path is set, then removes temp file", async () => {
		const tmp = await createTestTempDir();
		const tempPath = tmp.join("streamed.tmp");
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		await tmp.writeFile(tempPath, pdfBytes);

		const raw: RawImapAttachment = {
			contentType: "application/pdf",
			filename: "doc.pdf",
			size: pdfBytes.length,
			data: new Uint8Array(0),
			messageUid: 1 as MessageUid,
			path: tempPath,
			labels: [],
		};

		const emailSlug = "user1";
		const layer = Layer.mergeAll(
			TestBaseLayer,
			emailConfigTest({ emailAccountsPath: tmp.join("accounts.json") }),
		);

		const result = await Effect.runPromise(
			processRawAttachment(raw, 0, emailSlug).pipe(Effect.provide(layer)),
		);

		expect(result).not.toBe(null);
		expect(result?.data).toEqual(pdfBytes);
		expect(result?.filename).toBe("doc.pdf");

		const tempExists = await pathExists(tempPath);
		expect(tempExists).toBe(false);

		await tmp.remove();
	});
});
