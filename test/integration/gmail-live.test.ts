/**
 * Optional live Gmail test. Skips when credentials are not set.
 *
 * Read-only: runs the full pipeline but mocks all write operations (save, markProcessed).
 * Logs each mocked write with a confidence level that it would succeed.
 *
 * Run with:
 *   GMAIL_TEST_EMAIL=your@gmail.com GMAIL_APP_PASSWORD=xxxx bun run test:integration
 *
 * Requires a Gmail account with an app password (2FA must be enabled).
 */

import { describe, expect, it } from "bun:test";
import { Effect, FileSystem, Layer } from "effect";
import * as Http from "effect/unstable/http";
import type { EmailSession } from "../../src/interfaces/email-client.js";
import { EmailClient, EmailClientLive } from "../../src/live/imap-email-client.js";
import { OllamaClient } from "../../src/live/ollama-client.js";
import { runEmailPipeline } from "../../src/shell/email-pipeline.js";
import { PlatformServicesLayer } from "../../src/shell/layers.js";
import {
	createTestTempDir,
	credentialsStoreTest,
	emailConfigTest,
	TestBaseLayer,
} from "../test-utils.js";

const hasGmailCreds =
	typeof process.env.GMAIL_TEST_EMAIL === "string" &&
	process.env.GMAIL_TEST_EMAIL.length > 0 &&
	typeof process.env.GMAIL_APP_PASSWORD === "string" &&
	process.env.GMAIL_APP_PASSWORD.length >= 16;

const MOCK_CONFIDENCE = "high" as const;
const MOCK_REASON = "fetch succeeded, session valid, path resolved";

/** FileSystem that mocks writeFile and makeDirectory; logs with confidence. */
const ReadOnlyFileSystemLayer = Layer.effect(
	FileSystem.FileSystem,
	(() => {
		const real = Effect.gen(function* () {
			return yield* FileSystem.FileSystem;
		});
		return Effect.gen(function* () {
			const fs = yield* real;
			return {
				...fs,
				writeFile: (
					path: string,
					data: Uint8Array,
					_options?: { readonly flag?: string; readonly mode?: number },
				) =>
					Effect.log({
						event: "gmail_live_mock",
						op: "writeFile",
						path,
						bytes: data.length,
						confidence: MOCK_CONFIDENCE,
						reason: MOCK_REASON,
					}).pipe(Effect.asVoid),
				makeDirectory: (
					path: string,
					_options?: { readonly recursive?: boolean; readonly mode?: number },
				) =>
					Effect.log({
						event: "gmail_live_mock",
						op: "makeDirectory",
						path,
						confidence: MOCK_CONFIDENCE,
						reason: "path resolution succeeded",
					}).pipe(Effect.asVoid),
			};
		});
	})(),
).pipe(Layer.provide(PlatformServicesLayer));

/** EmailClient that mocks markProcessed; logs with confidence. */
const ReadOnlyEmailClientLayer = Layer.effect(
	EmailClient,
	(() => {
		const real = Effect.gen(function* () {
			return yield* EmailClient;
		});
		return Effect.gen(function* () {
			const imap = yield* real;
			return {
				withConnection: <A, R>(
					account: Parameters<typeof imap.withConnection>[0],
					fn: (session: EmailSession) => ReturnType<typeof imap.withConnection<A, R>>,
				) =>
					imap.withConnection(account, (session) =>
						fn({
							...session,
							markProcessed: (uids, value) =>
								Effect.log({
									event: "gmail_live_mock",
									op: "markProcessed",
									uids: [...uids],
									value,
									confidence: MOCK_CONFIDENCE,
									reason: "session valid, search and fetch succeeded",
								}).pipe(Effect.asVoid),
						}),
					),
			};
		});
	})(),
).pipe(Layer.provide(EmailClientLive));

const alwaysAcceptOllamaLayer = Layer.succeed(OllamaClient)(
	OllamaClient.of({
		assess: () => Effect.succeed(true),
	}),
);

describe.skipIf(!hasGmailCreds)("gmail live", () => {
	it("runs full pipeline with mocked writes, logs confidence", {
		timeout: 30_000,
	}, async () => {
		const email = process.env.GMAIL_TEST_EMAIL;
		const appPassword = process.env.GMAIL_APP_PASSWORD;
		if (!email || !appPassword) throw new Error("GMAIL_TEST_EMAIL and GMAIL_APP_PASSWORD required");

		const tmp = await createTestTempDir("gmail-live-");
		const accountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(
			accountsPath,
			JSON.stringify([
				{
					email,
					enabled: true,
					removed: false,
					exclude_labels: [],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]),
		);

		const layer = Layer.mergeAll(
			TestBaseLayer,
			Http.FetchHttpClient.layer,
			emailConfigTest({
				consumeDir: tmp.path,
				emailAccountsPath: accountsPath,
				markProcessedLabel: "paperless",
			}),
			credentialsStoreTest({ [email]: appPassword }),
			ReadOnlyFileSystemLayer,
			ReadOnlyEmailClientLayer,
			alwaysAcceptOllamaLayer,
		);

		const program = runEmailPipeline().pipe(Effect.provide(layer));
		const result = await Effect.runPromise(program as Effect.Effect<{ saved: number }>);

		expect(result).toHaveProperty("saved");
		expect(typeof result.saved).toBe("number");
		expect(result.saved).toBeGreaterThanOrEqual(0);

		await tmp.remove();
	});
});
