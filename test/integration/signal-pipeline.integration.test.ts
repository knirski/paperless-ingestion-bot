import { describe, expect } from "bun:test";
import { Effect, Exit, FileSystem, Layer, Option } from "effect";
import * as Http from "effect/unstable/http";
import type { SignalNumber } from "../../src/domain/signal-types.js";
import type { AppEffect } from "../../src/domain/types.js";
import {
	type ConsumeSubdir,
	createUserRegistry,
	type EmailLabel,
	type UserSlug,
} from "../../src/domain/types.js";
import { SignalClient } from "../../src/live/signal-client.js";
import type { SignalConfigService } from "../../src/shell/config.js";
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	processWebhookPayload,
	runServerStartupValidation,
} from "../../src/shell/signal-pipeline.js";
import {
	signalImageAttachment,
	signalIneligibleAttachment,
	signalPdfAttachment,
} from "../fixtures/attachments.js";
import { integrationTest, writeAccountsFile } from "../fixtures/integration-context.js";
import {
	createSignalMockLayer,
	type SignalMockScenario,
	type SignalMockSpy,
} from "../fixtures/signal-mock.js";
import {
	credentialsStoreTest,
	joinPathSync,
	readTestDirectory,
	runWithLayer,
	signalConfigTest,
	TestBaseLayer,
} from "../test-utils.js";

const AUTHORIZED_NUMBER = "+15550000001" as SignalNumber;
const UNAUTHORIZED_NUMBER = "+15550000009" as SignalNumber;

const DEFAULT_REGISTRY = createUserRegistry([
	{
		slug: "user1" as UserSlug,
		signalNumber: AUTHORIZED_NUMBER,
		consumeSubdir: "user1" as ConsumeSubdir,
		displayName: "User 1",
		tagName: "User 1",
	},
]);

function buildTestLayer(
	fixture: { tmpDir: string; emailAccountsPath: string },
	scenario: SignalMockScenario,
	options?: {
		spy?: SignalMockSpy;
		configOverrides?: Partial<SignalConfigService>;
		credentialsStore?: Record<string, string>;
		signalClientLayer?: Layer.Layer<SignalClient>;
	},
) {
	const { tmpDir, emailAccountsPath } = fixture;
	const consumeDir = joinPathSync(tmpDir, "consume");
	const signalLayer =
		options?.signalClientLayer ??
		createSignalMockLayer(scenario, {
			...(options?.spy != null && { spy: options.spy }),
			defaultAccount: AUTHORIZED_NUMBER,
		});
	return Layer.mergeAll(
		TestBaseLayer,
		Http.FetchHttpClient.layer,
		signalConfigTest({
			consumeDir,
			emailAccountsPath,
			registry: DEFAULT_REGISTRY,
			markProcessedLabel: "paperless" as EmailLabel,
			...options?.configOverrides,
		}),
		credentialsStoreTest(options?.credentialsStore ?? { "test@example.com": "secret" }),
		signalLayer,
	);
}

async function runWebhook(
	layer: ReturnType<typeof buildTestLayer>,
	payload: Parameters<typeof processWebhookPayload>[0],
): Promise<void> {
	await Effect.runPromise(
		processWebhookPayload(payload).pipe(Effect.provide(layer)) as AppEffect<void>,
	);
}

function createSpy(): SignalMockSpy {
	return {
		sendMessageCalls: [],
		fetchAttachmentCalls: [],
		getAccountCalls: 0,
	};
}

describe("signal-pipeline integration", () => {
	describe("happy path", () => {
		integrationTest(
			"runServerStartupValidation with skipReachabilityCheck — skips Signal API check",
			async ({ tmpDir, emailAccountsPath }) => {
				const consumeDir = joinPathSync(tmpDir, "consume");
				await Effect.runPromise(
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						yield* fs.makeDirectory(consumeDir, { recursive: true });
					}).pipe(Effect.provide(TestBaseLayer)),
				);
				const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {});
				await runWithLayer(layer)(runServerStartupValidation(true));
			},
		);

		integrationTest(
			"empty payload / no dataMessage — no reply, no error",
			async ({ tmpDir, emailAccountsPath }) => {
				// Empty partial mock: any SignalClient call would throw UnimplementedError.
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ signalClientLayer: Layer.mock(SignalClient)({}) },
				);
				await runWebhook(layer, {});
			},
		);

		integrationTest(
			"text-only, no command — help message sent",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {}, { spy });
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "hello" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Paperless Ingest Bot");
				expect(spy.sendMessageCalls[0]?.message).toContain("gmail add");
			},
		);

		integrationTest(
			"eligible attachments (PDF + image) — both saved",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: {
							...signalPdfAttachment("att1"),
							...signalImageAttachment("att2"),
						},
					},
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [
							{ id: "att1", customFilename: "doc.pdf", contentType: "application/pdf" },
							{ id: "att2", contentType: "image/jpeg" },
						],
					},
				});
				const files = await readTestDirectory(joinPathSync(consumeDir, "user1"));
				expect(files).toHaveLength(2);
				expect(files.some((f) => f.endsWith(".pdf"))).toBe(true);
				expect(files.some((f) => f.endsWith(".jpg") || f.endsWith(".jpeg"))).toBe(true);
				expect(spy.fetchAttachmentCalls).toContain("att1");
				expect(spy.fetchAttachmentCalls).toContain("att2");
			},
		);

		integrationTest(
			"gmail status (no accounts) — reply with setup instructions",
			async ({ tmpDir }) => {
				const accountsPath = await writeAccountsFile(tmpDir, []);
				const spy = createSpy();
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath: accountsPath },
					{},
					{ spy, credentialsStore: {} },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail status" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("No email accounts");
				expect(spy.sendMessageCalls[0]?.message).toContain("gmail add");
			},
		);

		integrationTest(
			"gmail status (with accounts) — reply with crawl status",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ spy, credentialsStore: { "test@example.com": "abcdefghijklmnop" } },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail status" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Email Crawl Status");
				expect(spy.sendMessageCalls[0]?.message).toContain("test@example.com: Active");
			},
		);

		integrationTest("gmail add — account persisted, reply confirms", async ({ tmpDir }) => {
			const accountsPath = await writeAccountsFile(tmpDir, []);
			const spy = createSpy();
			const layer = buildTestLayer({ tmpDir, emailAccountsPath: accountsPath }, {}, { spy });
			await runWebhook(layer, {
				sourceNumber: AUTHORIZED_NUMBER,
				dataMessage: { body: "gmail add add@example.com abcdefghijklmnop" },
			});
			expect(spy.sendMessageCalls).toHaveLength(1);
			expect(spy.sendMessageCalls[0]?.message).toContain("Added add@example.com");
			const { readFile } = await import("node:fs/promises");
			const content = await readFile(accountsPath, "utf-8");
			const accounts = JSON.parse(content);
			expect(accounts).toHaveLength(1);
			expect(accounts[0]).toMatchObject({
				email: "add@example.com",
				enabled: true,
				added_by: "user1",
			});
		});

		integrationTest("gmail add reactivation — same email with new password", async ({ tmpDir }) => {
			const accountsPath = await writeAccountsFile(tmpDir, [
				{
					email: "react@example.com",
					enabled: true,
					removed: false,
					exclude_labels: [],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]);
			const spy = createSpy();
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath: accountsPath },
				{},
				{ spy, credentialsStore: { "react@example.com": "oldpassword12345678" } },
			);
			await runWebhook(layer, {
				sourceNumber: AUTHORIZED_NUMBER,
				dataMessage: { body: "gmail add react@example.com newpassword12345678" },
			});
			expect(spy.sendMessageCalls).toHaveLength(1);
			expect(spy.sendMessageCalls[0]?.message).toContain("Re-activated");
		});

		integrationTest("gmail pause — account enabled: false, reply confirms", async ({ tmpDir }) => {
			const accountsPath = await writeAccountsFile(tmpDir, [
				{
					email: "pause@example.com",
					enabled: true,
					removed: false,
					exclude_labels: [],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]);
			const spy = createSpy();
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath: accountsPath },
				{},
				{ spy, credentialsStore: { "pause@example.com": "abcdefghijklmnop" } },
			);
			await runWebhook(layer, {
				sourceNumber: AUTHORIZED_NUMBER,
				dataMessage: { body: "gmail pause pause@example.com" },
			});
			expect(spy.sendMessageCalls).toHaveLength(1);
			expect(spy.sendMessageCalls[0]?.message).toContain("Paused scanning");
			const { readFile } = await import("node:fs/promises");
			const accounts = JSON.parse(await readFile(accountsPath, "utf-8"));
			expect(accounts[0]).toMatchObject({ email: "pause@example.com", enabled: false });
		});

		integrationTest("gmail resume — account re-enabled, reply confirms", async ({ tmpDir }) => {
			const accountsPath = await writeAccountsFile(tmpDir, [
				{
					email: "resume@example.com",
					enabled: false,
					removed: false,
					exclude_labels: [],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]);
			const spy = createSpy();
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath: accountsPath },
				{},
				{ spy, credentialsStore: { "resume@example.com": "abcdefghijklmnop" } },
			);
			await runWebhook(layer, {
				sourceNumber: AUTHORIZED_NUMBER,
				dataMessage: { body: "gmail resume resume@example.com" },
			});
			expect(spy.sendMessageCalls).toHaveLength(1);
			expect(spy.sendMessageCalls[0]?.message).toContain("Resumed scanning");
			const { readFile } = await import("node:fs/promises");
			const accounts = JSON.parse(await readFile(accountsPath, "utf-8"));
			expect(accounts[0]).toMatchObject({ email: "resume@example.com", enabled: true });
		});

		integrationTest("gmail remove — account removed: true, reply confirms", async ({ tmpDir }) => {
			const accountsPath = await writeAccountsFile(tmpDir, [
				{
					email: "remove@example.com",
					enabled: true,
					removed: false,
					exclude_labels: [],
					added_by: "user1",
					details: { type: "gmail" },
				},
			]);
			const spy = createSpy();
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath: accountsPath },
				{},
				{ spy, credentialsStore: { "remove@example.com": "abcdefghijklmnop" } },
			);
			await runWebhook(layer, {
				sourceNumber: AUTHORIZED_NUMBER,
				dataMessage: { body: "gmail remove remove@example.com" },
			});
			expect(spy.sendMessageCalls).toHaveLength(1);
			expect(spy.sendMessageCalls[0]?.message).toContain("Removed");
			const { readFile } = await import("node:fs/promises");
			const accounts = JSON.parse(await readFile(accountsPath, "utf-8"));
			expect(accounts[0]).toMatchObject({ email: "remove@example.com", removed: true });
		});

		integrationTest(
			"registry with multiple users — message from user2 saves to user2",
			async ({ tmpDir, emailAccountsPath }) => {
				const registry = createUserRegistry([
					{
						slug: "user1" as UserSlug,
						signalNumber: AUTHORIZED_NUMBER,
						consumeSubdir: "user1" as ConsumeSubdir,
						displayName: "User 1",
						tagName: "User 1",
					},
					{
						slug: "user2" as UserSlug,
						signalNumber: "+15550000002" as SignalNumber,
						consumeSubdir: "user2" as ConsumeSubdir,
						displayName: "User 2",
						tagName: "User 2",
					},
				]);
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalPdfAttachment("att1"),
					},
					{
						spy,
						configOverrides: { registry },
					},
				);
				await runWebhook(layer, {
					sourceNumber: "+15550000002" as SignalNumber,
					dataMessage: {
						body: "",
						attachments: [{ id: "att1", contentType: "application/pdf" }],
					},
				});
				const files = await readTestDirectory(joinPathSync(consumeDir, "user2"));
				expect(files).toHaveLength(1);
				expect(files[0]).toMatch(/\.pdf$/);
			},
		);
	});

	describe("failure scenarios", () => {
		integrationTest(
			"fetchAttachmentFail — pipeline rejects, no file saved",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalPdfAttachment("att1"),
						fetchAttachmentFail: new Error("fetch failed"),
					},
					{ spy },
				);
				const eff = processWebhookPayload({
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [{ id: "att1", contentType: "application/pdf" }],
					},
				}).pipe(Effect.provide(layer)) as AppEffect<void>;
				const exit = await Effect.runPromise(Effect.exit(eff));
				expect(Exit.isFailure(exit)).toBe(true);
				const err = Exit.findErrorOption(exit);
				expect(Option.isSome(err)).toBe(true);
				if (Option.isSome(err)) {
					expect(err.value).toMatchObject({ _tag: "ConfigValidationError" });
				}
				const files = await readTestDirectory(joinPathSync(consumeDir, "user1")).catch(() => []);
				expect(files).toHaveLength(0);
			},
		);

		integrationTest("sendMessageFail — pipeline rejects", async ({ tmpDir, emailAccountsPath }) => {
			const layer = buildTestLayer(
				{ tmpDir, emailAccountsPath },
				{ sendMessageFail: new Error("send failed") },
			);
			const eff = processWebhookPayload({
				sourceNumber: AUTHORIZED_NUMBER,
				dataMessage: { body: "hello" },
			}).pipe(Effect.provide(layer)) as AppEffect<void>;
			const exit = await Effect.runPromise(Effect.exit(eff));
			expect(Exit.isFailure(exit)).toBe(true);
		});

		integrationTest(
			"getAccountResult: Option.none() — no reply sent, pipeline succeeds",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{ getAccountResult: Option.none() },
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "hello" },
				});
				expect(spy.sendMessageCalls).toHaveLength(0);
			},
		);

		integrationTest(
			"gmail add invalid email — reply Invalid email format., no account saved",
			async ({ tmpDir }) => {
				const accountsPath = await writeAccountsFile(tmpDir, []);
				const spy = createSpy();
				const layer = buildTestLayer({ tmpDir, emailAccountsPath: accountsPath }, {}, { spy });
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail add invalid@com abcdefghijklmnop" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Invalid email");
				const { readFile } = await import("node:fs/promises");
				const content = await readFile(accountsPath, "utf-8");
				const accounts = JSON.parse(content);
				expect(accounts).toHaveLength(0);
			},
		);

		integrationTest(
			"gmail add short password — reply App password too short, no account saved",
			async ({ tmpDir }) => {
				const accountsPath = await writeAccountsFile(tmpDir, []);
				const spy = createSpy();
				const layer = buildTestLayer({ tmpDir, emailAccountsPath: accountsPath }, {}, { spy });
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail add short@example.com short" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("App password too short");
				const { readFile } = await import("node:fs/promises");
				const content = await readFile(accountsPath, "utf-8");
				const accounts = JSON.parse(content);
				expect(accounts).toHaveLength(0);
			},
		);
	});

	describe("edge cases", () => {
		integrationTest(
			"unauthorized source — reply Not authorized",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const registry = createUserRegistry([
					{
						slug: "user1" as UserSlug,
						signalNumber: "+15550000002" as SignalNumber,
						consumeSubdir: "user1" as ConsumeSubdir,
						displayName: "User 1",
						tagName: "User 1",
					},
				]);
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ spy, configOverrides: { registry } },
				);
				try {
					await runWebhook(layer, {
						sourceNumber: UNAUTHORIZED_NUMBER,
						dataMessage: { body: "gmail status" },
					});
				} catch {
					// Expected: pipeline fails after replying
				}
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Not authorized");
			},
		);

		integrationTest("no source — skipped, no reply", async ({ tmpDir, emailAccountsPath }) => {
			const spy = createSpy();
			const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {}, { spy });
			await runWebhook(layer, {
				dataMessage: { body: "hello" },
			});
			expect(spy.sendMessageCalls).toHaveLength(0);
		});

		integrationTest(
			"alternative payload structures — params.envelope and source: { number }",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {}, { spy });
				await runWebhook(layer, {
					params: {
						envelope: {
							sourceNumber: AUTHORIZED_NUMBER,
							dataMessage: { body: "gmail status" },
						},
					},
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Email Crawl Status");

				spy.sendMessageCalls.length = 0;
				await runWebhook(layer, {
					source: { number: AUTHORIZED_NUMBER },
					dataMessage: { body: "gmail status" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
			},
		);

		integrationTest(
			"ineligible attachment (text/calendar) — no file saved, reply with file types",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalIneligibleAttachment("att1"),
					},
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [
							{ id: "att1", contentType: "text/calendar", customFilename: "event.ics" },
						],
					},
				});
				const files = await readTestDirectory(joinPathSync(consumeDir, "user1")).catch(() => []);
				expect(files).toHaveLength(0);
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Valid types");
			},
		);

		integrationTest(
			"empty fetchAttachment response — no file saved, reply with file types",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{ fetchAttachmentData: {} },
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [{ id: "unknown", contentType: "application/pdf" }],
					},
				});
				const files = await readTestDirectory(joinPathSync(consumeDir, "user1")).catch(() => []);
				expect(files).toHaveLength(0);
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Valid types");
			},
		);

		integrationTest(
			"malformed attachments (no id, null, array) — skipped, not fetched",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalPdfAttachment("att1"),
					},
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [
							{ customFilename: "a.pdf" },
							null,
							[],
							{ id: "att1", contentType: "application/pdf" },
						],
					},
				} as Parameters<typeof processWebhookPayload>[0]);
				expect(spy.fetchAttachmentCalls).toEqual(["att1"]);
			},
		);

		integrationTest(
			"mixed attachments (some eligible, some not) — correct count saved",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: {
							...signalPdfAttachment("att1"),
							...signalIneligibleAttachment("att2"),
							...signalImageAttachment("att3"),
						},
					},
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [
							{ id: "att1", contentType: "application/pdf" },
							{ id: "att2", contentType: "text/calendar" },
							{ id: "att3", contentType: "image/jpeg" },
						],
					},
				});
				const files = await readTestDirectory(joinPathSync(consumeDir, "user1"));
				expect(files).toHaveLength(2);
				expect(spy.fetchAttachmentCalls).toHaveLength(3);
			},
		);

		integrationTest(
			"more than 20 attachments — trimmed to MAX_ATTACHMENTS_PER_MESSAGE",
			async ({ tmpDir, emailAccountsPath }) => {
				const attCount = MAX_ATTACHMENTS_PER_MESSAGE + 5;
				const fetchData: Record<string, Uint8Array> = {};
				for (let i = 0; i < attCount; i++) {
					Object.assign(fetchData, signalPdfAttachment(`att${i}`));
				}
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{ fetchAttachmentData: fetchData },
					{ spy },
				);
				const attachments = Array.from({ length: attCount }, (_, i) => ({
					id: `att${i}`,
					contentType: "application/pdf",
				}));
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "", attachments },
				});
				const files = await readTestDirectory(joinPathSync(consumeDir, "user1"));
				expect(files).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
				expect(spy.fetchAttachmentCalls).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
			},
		);

		integrationTest(
			"file path collision — 2 PDFs with same customFilename",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const consumeDir = joinPathSync(tmpDir, "consume");
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: {
							...signalPdfAttachment("att1"),
							...signalPdfAttachment("att2"),
						},
					},
					{ spy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [
							{ id: "att1", customFilename: "doc.pdf", contentType: "application/pdf" },
							{ id: "att2", customFilename: "doc.pdf", contentType: "application/pdf" },
						],
					},
				});
				const files = (await readTestDirectory(joinPathSync(consumeDir, "user1"))).toSorted();
				expect(files).toHaveLength(2);
				expect(files).toContain("doc.pdf");
				expect(files).toContain("doc_1.pdf");
			},
		);

		integrationTest(
			"gmail pause on non-existent account — reply No account found",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {}, { spy });
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail pause nonexistent@example.com" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("No account found");
			},
		);

		integrationTest(
			"gmail remove on non-existent account — reply No account found",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {}, { spy });
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail remove nonexistent@example.com" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("No account found");
			},
		);

		integrationTest(
			"gmail resume on removed account — reply was removed. Re-add",
			async ({ tmpDir }) => {
				const accountsPath = await writeAccountsFile(tmpDir, [
					{
						email: "removed@example.com",
						enabled: false,
						removed: true,
						exclude_labels: [],
						added_by: "user1",
						details: { type: "gmail" },
					},
				]);
				const spy = createSpy();
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath: accountsPath },
					{},
					{ spy, credentialsStore: { "removed@example.com": "abcdefghijklmnop" } },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "gmail resume removed@example.com" },
				});
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("was removed");
				expect(spy.sendMessageCalls[0]?.message).toContain("gmail add");
			},
		);
	});
});
