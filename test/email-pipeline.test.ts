import { assert, describe, expect, it, test } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import * as Http from "effect/unstable/http";
import type { ImapSearchQuery } from "../src/core/search.js";
import type { AppEffect, EmailLabel, MessageUid } from "../src/domain/types.js";
import type { RawAttachment } from "../src/interfaces/email-client.js";
import type { OllamaClientService } from "../src/interfaces/ollama-client.js";
import { EmailClient } from "../src/live/imap-email-client.js";
import { OllamaClient } from "../src/live/ollama-client.js";
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
			emailConfigTest({ consumeDir: tmp.path, emailAccountsPath }),
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
				consumeDir: tmp.path,
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
				consumeDir: tmp.path,
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
	const mockFsLayer = (mockFs: FileSystem.FileSystem) =>
		Layer.succeed(FileSystem.FileSystem)(mockFs);
	const mockOllamaLayer = (mockOllama: OllamaClientService) =>
		Layer.succeed(OllamaClient)(mockOllama);

	it.effect("empty toSave returns saved: 0, labeledUids: []", () =>
		Effect.gen(function* () {
			const mockFs = {
				writeFile: () => Effect.void,
			} as unknown as FileSystem.FileSystem;
			const mockOllama = {
				assess: () => Effect.succeed(true),
			} as unknown as OllamaClientService;
			const result = yield* saveEligibleAttachments([]).pipe(
				Effect.provide(mockFsLayer(mockFs)),
				Effect.provide(mockOllamaLayer(mockOllama)),
			);
			assert.deepStrictEqual(result, { saved: 0, labeledUids: [] });
		}),
	);

	it.effect("item with ollamaReq: false rejects, not saved", () =>
		Effect.gen(function* () {
			const mockFs = {
				writeFile: () => Effect.void,
			} as unknown as FileSystem.FileSystem;
			const assessCalls: unknown[] = [];
			const mockOllama = {
				assess: (req: unknown) => {
					assessCalls.push(req);
					return Effect.succeed(false);
				},
			} as unknown as OllamaClientService;
			const toSave: AttachmentToSave[] = [
				{
					path: "/tmp/out.pdf",
					data: new Uint8Array([1, 2, 3]),
					ollamaReq: { model: "x", prompt: "y", stream: false },
					messageUid: 42 as MessageUid,
				},
			];
			const result = yield* saveEligibleAttachments(toSave).pipe(
				Effect.provide(mockFsLayer(mockFs)),
				Effect.provide(mockOllamaLayer(mockOllama)),
			);
			assert.strictEqual(result.saved, 0);
			assert.deepStrictEqual(result.labeledUids, []);
			assert.strictEqual(assessCalls.length, 1);
		}),
	);

	it.effect("item with ollamaReq: true accepts, saved", () =>
		Effect.gen(function* () {
			let writtenPath: string | undefined;
			let writtenData: Uint8Array | undefined;
			const mockFs = {
				writeFile: (path: string, data: Uint8Array) => {
					writtenPath = path;
					writtenData = data;
					return Effect.void;
				},
			} as unknown as FileSystem.FileSystem;
			const mockOllama = {
				assess: () => Effect.succeed(true),
			} as unknown as OllamaClientService;
			const toSave: AttachmentToSave[] = [
				{
					path: "/tmp/out.pdf",
					data: new Uint8Array([1, 2, 3]),
					ollamaReq: { model: "x", prompt: "y", stream: false },
					messageUid: 42 as MessageUid,
				},
			];
			const result = yield* saveEligibleAttachments(toSave).pipe(
				Effect.provide(mockFsLayer(mockFs)),
				Effect.provide(mockOllamaLayer(mockOllama)),
			);
			assert.strictEqual(result.saved, 1);
			assert.deepStrictEqual(result.labeledUids, [42]);
			assert.strictEqual(writtenPath, "/tmp/out.pdf");
			assert.deepStrictEqual(writtenData, new Uint8Array([1, 2, 3]));
		}),
	);
});

describe("processRawAttachment", () => {
	it("reads from path when raw.path is set, then removes temp file", async () => {
		const tmp = await createTestTempDir();
		const tempPath = tmp.join("streamed.tmp");
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		await tmp.writeFile(tempPath, pdfBytes);

		const raw: RawAttachment = {
			contentType: "application/pdf",
			filename: "doc.pdf",
			size: pdfBytes.length,
			data: new Uint8Array(0),
			messageUid: 1 as MessageUid,
			path: tempPath,
		};

		const emailSubdir = tmp.join("user1");
		const layer = Layer.mergeAll(
			TestBaseLayer,
			emailConfigTest({ consumeDir: tmp.path, emailAccountsPath: tmp.join("accounts.json") }),
		);

		const result = await Effect.runPromise(
			processRawAttachment(raw, 0, emailSubdir).pipe(Effect.provide(layer)),
		);

		assert.notStrictEqual(result, null);
		assert.deepStrictEqual(result?.data, pdfBytes);
		assert.ok(result?.path.startsWith(tmp.path));

		const tempExists = await pathExists(tempPath);
		assert.strictEqual(tempExists, false, "temp file should be removed");

		await tmp.remove();
	});
});
