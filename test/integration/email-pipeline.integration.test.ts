import { Effect, Exit, Layer } from "effect";
import * as Http from "effect/unstable/http";
import { describe, expect } from "vitest";
import { emailToSlug } from "../../src/core/search.js";
import type { SignalNumber } from "../../src/domain/signal-types.js";
import type { AppEffect } from "../../src/domain/types.js";
import {
	type ConsumeSubdir,
	createUserRegistry,
	type EmailLabel,
	type UserSlug,
} from "../../src/domain/types.js";
import { EmailClient } from "../../src/live/imap-email-client.js";
import { OllamaClient } from "../../src/live/ollama-client.js";
import type { EmailConfigService } from "../../src/shell/config.js";
import {
	imapRetryScheduleFast,
	MAX_ATTACHMENT_SIZE,
	runEmailPipeline,
} from "../../src/shell/email-pipeline.js";
import { RateLimiterMemoryLayer } from "../../src/shell/layers.js";
import {
	blockedIcsAttachment,
	eligibleImageAttachment,
	eligiblePdfAttachment,
	ineligibleSmallImage,
} from "../fixtures/attachments.js";
import {
	createImapMockLayer,
	type ImapMockScenario,
	type ImapMockSpy,
} from "../fixtures/imap-mock.js";
import {
	DEFAULT_ACCOUNT,
	type IntegrationFixture,
	integrationTest,
	writeAccountsFile,
} from "../fixtures/integration-context.js";
import { createSignalMockLayer, type SignalMockSpy } from "../fixtures/signal-mock.js";
import {
	credentialsStoreTest,
	emailConfigTest,
	joinPath,
	readTestDirectory,
	TestBaseLayer,
} from "../test-utils.js";

const alwaysAcceptOllamaLayer = Layer.mock(OllamaClient)({
	assess: () => Effect.succeed(true),
});
const rejectOllamaLayer = Layer.mock(OllamaClient)({
	assess: () => Effect.succeed(false),
});

function accountSubdir(tmpDir: string, email = "test@example.com"): Promise<string> {
	return joinPath(tmpDir, emailToSlug(email));
}

async function runPipeline(layer: Layer.Layer<never>): Promise<{ saved: number }> {
	return Effect.runPromise(
		runEmailPipeline().pipe(Effect.provide(layer)) as AppEffect<{ saved: number }>,
	);
}

const CREDENTIAL_FAILURE_REGISTRY = createUserRegistry([
	{
		slug: "user1" as UserSlug,
		signalNumber: "+15550000001" as SignalNumber,
		consumeSubdir: "user1" as ConsumeSubdir,
		displayName: "User 1",
		tagName: "User 1",
	},
]);

function buildTestLayer(
	fixture: IntegrationFixture,
	scenario: ImapMockScenario,
	options?: {
		spy?: ImapMockSpy;
		signalSpy?: SignalMockSpy;
		configOverrides?: Partial<EmailConfigService>;
		ollama?: Layer.Layer<never>;
	},
): Layer.Layer<never> {
	const { tmpDir, emailAccountsPath } = fixture;
	const ollama = options?.ollama ?? alwaysAcceptOllamaLayer;
	return Layer.mergeAll(
		TestBaseLayer,
		Http.FetchHttpClient.layer,
		RateLimiterMemoryLayer,
		emailConfigTest({
			consumeDir: tmpDir,
			emailAccountsPath,
			markProcessedLabel: "paperless" as EmailLabel,
			registry: CREDENTIAL_FAILURE_REGISTRY,
			...options?.configOverrides,
		}),
		credentialsStoreTest({ "test@example.com": "secret" }),
		createImapMockLayer(scenario, options?.spy ? { spy: options.spy } : undefined),
		createSignalMockLayer(
			{},
			{
				...(options?.signalSpy != null && { spy: options.signalSpy }),
				defaultAccount: "+15550000001" as SignalNumber,
			},
		),
		ollama,
	);
}

describe("email-pipeline integration", () => {
	describe("happy path", () => {
		integrationTest("empty mailbox", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer({ tmpDir, emailAccountsPath }, { searchResult: [] }, { spy });
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 0 });
			const files = await readTestDirectory(await accountSubdir(tmpDir));
			expect(files).toHaveLength(0);
		});

		integrationTest("one eligible PDF", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [eligiblePdfAttachment(1)],
				},
				{ spy },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 1 });
			const files = await readTestDirectory(await accountSubdir(tmpDir));
			expect(files).toHaveLength(1);
			expect(files[0]).toMatch(/\.pdf$/);
			expect(spy.markProcessedCalls).toEqual([{ uids: [1], value: "paperless" }]);
		});

		integrationTest("ineligible attachment", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [ineligibleSmallImage(1)],
				},
				{ spy },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 0 });
			expect(spy.markProcessedCalls).toHaveLength(0);
		});

		integrationTest("Ollama rejects", async ({ tmpDir, emailAccountsPath }) => {
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [eligibleImageAttachment(1)],
				},
				{ ollama: rejectOllamaLayer },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 0 });
		});

		integrationTest("pagination", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1, 2],
					attachmentsCb: (uids) => (uids.includes(2) ? [eligiblePdfAttachment(2)] : []),
				},
				{ spy, configOverrides: { pageSize: 1 } },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 1 });
			expect(spy.fetchCalls).toHaveLength(2);
			expect(spy.fetchCalls[0]).toEqual({ uids: [1], maxSize: MAX_ATTACHMENT_SIZE });
			expect(spy.fetchCalls[1]).toEqual({ uids: [2], maxSize: MAX_ATTACHMENT_SIZE });
		});

		integrationTest("markProcessedLabel empty", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [eligiblePdfAttachment(1)],
				},
				{
					spy,
					configOverrides: {
						markProcessedLabel: "" as EmailLabel,
					},
				},
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 1 });
			expect(spy.markProcessedCalls).toHaveLength(0);
		});

		integrationTest("blocked MIME type", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [blockedIcsAttachment(1)],
				},
				{ spy },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 0 });
			expect(spy.markProcessedCalls).toHaveLength(0);
		});
	});

	describe("failure scenarios", () => {
		integrationTest("search failure degrades gracefully", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{ searchResult: [1], searchFail: new Error("IMAP timeout") },
				{ spy, configOverrides: { imapRetrySchedule: imapRetryScheduleFast } },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 0 });
			expect(spy.searchCalls.length).toBeGreaterThanOrEqual(1);
			const files = await readTestDirectory(await accountSubdir(tmpDir));
			expect(files).toHaveLength(0);
		});

		integrationTest("fetch failure degrades gracefully", async ({ tmpDir, emailAccountsPath }) => {
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [eligiblePdfAttachment(1)],
					fetchFail: new Error("Connection lost"),
				},
				{ spy, configOverrides: { imapRetrySchedule: imapRetryScheduleFast } },
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 0 });
			expect(spy.fetchCalls.length).toBeGreaterThanOrEqual(1);
			expect(spy.markProcessedCalls).toHaveLength(0);
		});

		integrationTest("markProcessed failure propagates", async ({ tmpDir, emailAccountsPath }) => {
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{
					searchResult: [1],
					attachments: [eligiblePdfAttachment(1)],
					markProcessedFail: new Error("Label add failed"),
				},
			);
			await expect(runPipeline(layer)).rejects.toMatchObject({
				_tag: "ImapConnectionError",
			});
		});
	});

	describe("edge cases", () => {
		integrationTest("multiple accounts", async ({ tmpDir }) => {
			const otherAccount = {
				...DEFAULT_ACCOUNT,
				email: "other@example.com",
			};
			const accountsPath = await writeAccountsFile(tmpDir, [DEFAULT_ACCOUNT, otherAccount]);
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = Layer.mergeAll(
				TestBaseLayer,
				emailConfigTest({
					consumeDir: tmpDir,
					emailAccountsPath: accountsPath,
					markProcessedLabel: "paperless" as EmailLabel,
				}),
				credentialsStoreTest({
					"test@example.com": "secret",
					"other@example.com": "secret2",
				}),
				createImapMockLayer(
					{
						searchResult: [1],
						attachments: [eligiblePdfAttachment(1)],
					},
					{ spy },
				),
				alwaysAcceptOllamaLayer,
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 2 });
			const files1 = await readTestDirectory(await accountSubdir(tmpDir, "test@example.com"));
			const files2 = await readTestDirectory(await accountSubdir(tmpDir, "other@example.com"));
			expect(files1).toHaveLength(1);
			expect(files2).toHaveLength(1);
			expect(spy.markProcessedCalls).toHaveLength(2);
		});

		integrationTest("paused account is skipped", async ({ tmpDir }) => {
			const accountsPath = await writeAccountsFile(tmpDir, [
				DEFAULT_ACCOUNT,
				{ ...DEFAULT_ACCOUNT, email: "paused@example.com", enabled: false },
			]);
			const spy: ImapMockSpy = {
				searchCalls: [],
				fetchCalls: [],
				markProcessedCalls: [],
			};
			const layer = Layer.mergeAll(
				TestBaseLayer,
				emailConfigTest({
					consumeDir: tmpDir,
					emailAccountsPath: accountsPath,
					markProcessedLabel: "paperless" as EmailLabel,
				}),
				credentialsStoreTest({
					"test@example.com": "secret",
					"paused@example.com": "secret2",
				}),
				createImapMockLayer(
					{ searchResult: [1], attachments: [eligiblePdfAttachment(1)] },
					{ spy },
				),
				alwaysAcceptOllamaLayer,
			);
			const result = await runPipeline(layer);
			expect(result).toEqual({ saved: 1 });
			expect(spy.searchCalls).toHaveLength(1);
		});

		integrationTest(
			"connectFail with auth error — credential failure notification sent",
			async ({ tmpDir, emailAccountsPath }) => {
				const signalSpy: SignalMockSpy = {
					sendMessageCalls: [],
					fetchAttachmentCalls: [],
					getAccountCalls: 0,
				};
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						connectFail: new Error("Authentication failed for user"),
					},
					{ signalSpy },
				);
				const exit = await Effect.runPromise(
					Effect.exit(
						runEmailPipeline().pipe(Effect.provide(layer)) as AppEffect<{ saved: number }>,
					),
				);
				expect(Exit.isFailure(exit)).toBe(true);
				expect(signalSpy.sendMessageCalls).toHaveLength(1);
				expect(signalSpy.sendMessageCalls[0]?.message).toContain("test@example.com");
				expect(signalSpy.sendMessageCalls[0]?.message).toContain("Credentials");
				expect(signalSpy.sendMessageCalls[0]?.message).toContain("gmail add");
				expect(signalSpy.sendMessageCalls[0]?.recipient).toBe("+15550000001");
			},
		);

		integrationTest(
			"account without credentials is skipped",
			async ({ tmpDir, emailAccountsPath }) => {
				const layer = Layer.mergeAll(
					TestBaseLayer,
					emailConfigTest({
						consumeDir: tmpDir,
						emailAccountsPath,
						markProcessedLabel: "paperless" as EmailLabel,
					}),
					credentialsStoreTest({}),
					Layer.mock(EmailClient)({}),
					alwaysAcceptOllamaLayer,
				);
				const result = await runPipeline(layer);
				expect(result).toEqual({ saved: 0 });
			},
		);
	});
});
