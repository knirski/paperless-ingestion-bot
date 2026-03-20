import { describe, expect } from "bun:test";
import { Effect, Exit, Layer, Option } from "effect";
import * as Http from "effect/unstable/http";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import { toTagName } from "../../src/domain/paperless-types.js";
import type { SignalNumber } from "../../src/domain/signal-types.js";
import type { AppEffect } from "../../src/domain/types.js";
import { createUserRegistry, type EmailLabel, type UserSlug } from "../../src/domain/types.js";
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
import { createPaperlessMockLayer, type PaperlessMockSpy } from "../fixtures/paperless-mock.js";
import {
	createSignalMockLayer,
	type SignalMockScenario,
	type SignalMockSpy,
} from "../fixtures/signal-mock.js";
import {
	credentialsStoreTest,
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
		displayName: "User 1",
	},
]);

/** Mock HttpClient that returns 200 for any request. Use for validateSignalApiReachability tests. */
const mockHttpClientOkLayer = Layer.succeed(HttpClient.HttpClient)(
	HttpClient.make((request) =>
		Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))),
	),
);

/** Mock HttpClient that returns 500. Use to cover validateSignalApiReachability status >= 500 branch. */
const mockHttpClient500Layer = Layer.succeed(HttpClient.HttpClient)(
	HttpClient.make((request) =>
		Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 500 }))),
	),
);

/** Mock HttpClient that fails. Use to cover validateSignalApiReachability mapError branch. */
const mockHttpClientFailLayer = Layer.succeed(HttpClient.HttpClient)(
	HttpClient.make((request) =>
		Effect.fail(
			new HttpClientError.HttpClientError({
				reason: new HttpClientError.TransportError({
					request,
					cause: new Error("connection refused"),
					description: "connection refused",
				}),
			}),
		),
	),
);

function buildTestLayer(
	fixture: { tmpDir: string; emailAccountsPath: string },
	scenario: SignalMockScenario,
	options?: {
		spy?: SignalMockSpy;
		paperlessSpy?: PaperlessMockSpy;
		configOverrides?: Partial<SignalConfigService>;
		credentialsStore?: Record<string, string>;
		signalClientLayer?: Layer.Layer<SignalClient>;
		httpClientLayer?: Layer.Layer<HttpClient.HttpClient>;
	},
) {
	const { emailAccountsPath } = fixture;
	const signalLayer =
		options?.signalClientLayer ??
		createSignalMockLayer(scenario, {
			...(options?.spy != null && { spy: options.spy }),
			defaultAccount: AUTHORIZED_NUMBER,
		});
	const httpClientLayer = options?.httpClientLayer ?? Http.FetchHttpClient.layer;
	const paperlessSpy = options?.paperlessSpy;
	return Layer.mergeAll(
		TestBaseLayer,
		httpClientLayer,
		signalConfigTest({
			emailAccountsPath,
			registry: DEFAULT_REGISTRY,
			markProcessedLabel: "paperless" as EmailLabel,
			...options?.configOverrides,
		}),
		credentialsStoreTest(options?.credentialsStore ?? { "test@example.com": "secret" }),
		signalLayer,
		createPaperlessMockLayer(paperlessSpy),
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
			"runServerStartupValidation with skipReachabilityCheck — skips API checks",
			async ({ tmpDir, emailAccountsPath }) => {
				const layer = buildTestLayer({ tmpDir, emailAccountsPath }, {});
				await runWithLayer(layer)(runServerStartupValidation(true));
			},
		);

		integrationTest(
			"runServerStartupValidation without skipReachabilityCheck — runs Paperless and Signal API reachability checks",
			async ({ tmpDir, emailAccountsPath }) => {
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ httpClientLayer: mockHttpClientOkLayer },
				);
				await runWithLayer(layer)(runServerStartupValidation(false));
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
			"eligible attachments (PDF + image) — both uploaded to Paperless",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: {
							...signalPdfAttachment("att1"),
							...signalImageAttachment("att2"),
						},
					},
					{ spy, paperlessSpy },
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
				expect(paperlessSpy.uploadCalls).toHaveLength(2);
				expect(paperlessSpy.uploadCalls.some((u) => u.filename.endsWith(".pdf"))).toBe(true);
				expect(
					paperlessSpy.uploadCalls.some(
						(u) => u.filename.endsWith(".jpg") || u.filename.endsWith(".jpeg"),
					),
				).toBe(true);
				expect(
					paperlessSpy.uploadCalls.every((u) => u.tags.includes(toTagName("signal-user1"))),
				).toBe(true);
				expect(paperlessSpy.uploadCalls.every((u) => u.tags.includes(toTagName("signal")))).toBe(
					true,
				);
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
						displayName: "User 1",
					},
					{
						slug: "user2" as UserSlug,
						signalNumber: "+15550000002" as SignalNumber,
						displayName: "User 2",
					},
				]);
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalPdfAttachment("att1"),
					},
					{
						spy,
						paperlessSpy,
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
				expect(paperlessSpy.uploadCalls).toHaveLength(1);
				expect(paperlessSpy.uploadCalls[0]?.filename).toMatch(/\.pdf$/);
				expect(paperlessSpy.uploadCalls[0]?.tags).toContain(toTagName("signal-user2"));
			},
		);
	});

	describe("failure scenarios", () => {
		integrationTest(
			"runServerStartupValidation with empty registry — fails No users configured",
			async ({ tmpDir, emailAccountsPath }) => {
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ configOverrides: { registry: createUserRegistry([]) } },
				);
				const eff = runServerStartupValidation(true).pipe(Effect.provide(layer), Effect.exit);
				const exit = await Effect.runPromise(eff);
				expect(Exit.isFailure(exit)).toBe(true);
				const err = Exit.findErrorOption(exit);
				expect(Option.isSome(err)).toBe(true);
				if (Option.isSome(err)) {
					expect(err.value).toMatchObject({
						_tag: "ConfigValidationError",
						message: "No users configured",
					});
				}
			},
		);

		integrationTest(
			"runServerStartupValidation without skipReachabilityCheck — Signal API returns 500",
			async ({ tmpDir, emailAccountsPath }) => {
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ httpClientLayer: mockHttpClient500Layer },
				);
				const eff = runServerStartupValidation(false).pipe(Effect.provide(layer), Effect.exit);
				const exit = await Effect.runPromise(eff);
				expect(Exit.isFailure(exit)).toBe(true);
				const err = Exit.findErrorOption(exit);
				expect(Option.isSome(err)).toBe(true);
				if (Option.isSome(err)) {
					expect(err.value).toMatchObject({
						_tag: "ConfigValidationError",
						message: expect.stringContaining("HTTP 500"),
					});
				}
			},
		);

		integrationTest(
			"runServerStartupValidation without skipReachabilityCheck — Signal API unreachable",
			async ({ tmpDir, emailAccountsPath }) => {
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{},
					{ httpClientLayer: mockHttpClientFailLayer },
				);
				const eff = runServerStartupValidation(false).pipe(Effect.provide(layer), Effect.exit);
				const exit = await Effect.runPromise(eff);
				expect(Exit.isFailure(exit)).toBe(true);
				const err = Exit.findErrorOption(exit);
				expect(Option.isSome(err)).toBe(true);
				if (Option.isSome(err)) {
					expect(err.value).toMatchObject({
						_tag: "ConfigValidationError",
						message: expect.stringContaining("not reachable"),
					});
				}
			},
		);

		integrationTest(
			"fetchAttachmentFail — pipeline rejects, no upload",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalPdfAttachment("att1"),
						fetchAttachmentFail: new Error("fetch failed"),
					},
					{ spy, paperlessSpy },
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
				expect(paperlessSpy.uploadCalls).toHaveLength(0);
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
						displayName: "User 1",
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
			"ineligible attachment (text/calendar) — no upload, reply with file types",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: signalIneligibleAttachment("att1"),
					},
					{ spy, paperlessSpy },
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
				expect(paperlessSpy.uploadCalls).toHaveLength(0);
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Valid types");
			},
		);

		integrationTest(
			"empty fetchAttachment response — no upload, reply with file types",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{ fetchAttachmentData: {} },
					{ spy, paperlessSpy },
				);
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [{ id: "unknown", contentType: "application/pdf" }],
					},
				});
				expect(paperlessSpy.uploadCalls).toHaveLength(0);
				expect(spy.sendMessageCalls).toHaveLength(1);
				expect(spy.sendMessageCalls[0]?.message).toContain("Valid types");
			},
		);

		integrationTest(
			"malformed attachments (no id) — fail fast, no fetch",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{ fetchAttachmentData: signalPdfAttachment("att1") },
					{ spy },
				);
				const eff = processWebhookPayload({
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: {
						body: "",
						attachments: [
							{ customFilename: "a.pdf" },
							{ id: "att1", contentType: "application/pdf" },
						],
					},
				} as Parameters<typeof processWebhookPayload>[0]).pipe(
					Effect.provide(layer),
				) as AppEffect<void>;
				const exit = await Effect.runPromise(Effect.exit(eff));
				expect(Exit.isFailure(exit)).toBe(true);
				const err = Exit.findErrorOption(exit);
				expect(Option.isSome(err)).toBe(true);
				if (Option.isSome(err))
					expect(err.value).toMatchObject({
						_tag: "InvalidAttachmentRefError",
						index: 0,
					});
				expect(spy.fetchAttachmentCalls).toHaveLength(0);
			},
		);

		integrationTest(
			"mixed attachments (some eligible, some not) — correct count uploaded",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: {
							...signalPdfAttachment("att1"),
							...signalIneligibleAttachment("att2"),
							...signalImageAttachment("att3"),
						},
					},
					{ spy, paperlessSpy },
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
				expect(paperlessSpy.uploadCalls).toHaveLength(2);
				expect(spy.fetchAttachmentCalls).toHaveLength(3);
			},
		);

		integrationTest(
			"more than MAX_ATTACHMENTS_PER_MESSAGE attachments — trimmed",
			async ({ tmpDir, emailAccountsPath }) => {
				const attCount = MAX_ATTACHMENTS_PER_MESSAGE + 5;
				const fetchData: Record<string, Uint8Array> = {};
				for (let i = 0; i < attCount; i++) {
					Object.assign(fetchData, signalPdfAttachment(`att${i}`));
				}
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{ fetchAttachmentData: fetchData },
					{ spy, paperlessSpy },
				);
				const attachments = Array.from({ length: attCount }, (_, i) => ({
					id: `att${i}`,
					contentType: "application/pdf",
				}));
				await runWebhook(layer, {
					sourceNumber: AUTHORIZED_NUMBER,
					dataMessage: { body: "", attachments },
				});
				expect(paperlessSpy.uploadCalls).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
				expect(spy.fetchAttachmentCalls).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
			},
		);

		integrationTest(
			"2 PDFs with same customFilename — both uploaded (Paperless accepts duplicate filenames)",
			async ({ tmpDir, emailAccountsPath }) => {
				const spy = createSpy();
				const paperlessSpy: PaperlessMockSpy = { uploadCalls: [] };
				const layer = buildTestLayer(
					{ tmpDir, emailAccountsPath },
					{
						fetchAttachmentData: {
							...signalPdfAttachment("att1"),
							...signalPdfAttachment("att2"),
						},
					},
					{ spy, paperlessSpy },
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
				expect(paperlessSpy.uploadCalls).toHaveLength(2);
				expect(paperlessSpy.uploadCalls.every((u) => u.filename === "doc.pdf")).toBe(true);
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
