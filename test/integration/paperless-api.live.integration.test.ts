/**
 * Optional live Paperless API test. Skips when PAPERLESS_API_INTEGRATION_TEST is not set.
 * Requires Docker. Runs real paperless-ngx via Testcontainers.
 *
 * Uses beforeAll/afterAll for compose lifecycle so we can split into multiple it() blocks.
 * API responses decoded via HttpClient + Schema (filterStatusOk, schemaBodyJson).
 *
 * **Test order:** Tests run sequentially and share state. "reuses existing tag when found"
 * depends on "uploads document and resolves tags" having created the signal-test tag.
 *
 * **API version:** Same as production — see README Config (Paperless API version contract).
 *
 * Run with:
 *   PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration:live
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join as pathJoin } from "node:path";
import { Effect, Exit, FileSystem, Layer, Option, Path } from "effect";
import * as Http from "effect/unstable/http";
import {
	DockerComposeEnvironment,
	type StartedDockerComposeEnvironment,
	Wait,
} from "testcontainers";
import { type DomainError, PaperlessApiError } from "../../src/domain/errors.js";
import { toTagName } from "../../src/domain/paperless-types.js";
import { PaperlessClient } from "../../src/live/paperless-client.js";
import { PlatformServicesLayer } from "../../src/shell/layers.js";
import { runWithExit, TestBaseLayer } from "../test-utils.js";
import {
	apiGetDocuments,
	apiGetStatus,
	apiGetTags,
	apiPostToken,
	findDocByFilename,
	pollUntilDocumentWithFilename,
	pollUntilDocumentWithTag,
	pollUntilDocumentWithTagId,
} from "./paperless-api-helpers.js";

const runPaperlessApiIntegrationTest = process.env.PAPERLESS_API_INTEGRATION_TEST === "1";

const COMPOSE_DIR = pathJoin(process.cwd(), "deploy", "compose");
const COMPOSE_FILE = "docker-compose.full-stack.yml";
const ENV_INTEGRATION_TESTS = pathJoin(COMPOSE_DIR, ".env.integration-tests");
const SERVICES = ["broker", "db", "gotenberg", "tika", "webserver"] as const;
// Must match deploy/compose/.env.integration-tests
const PAPERLESS_ADMIN_USER = "admin";
const PAPERLESS_ADMIN_PASSWORD = "test-admin-password";

// Docker Compose v2 names first replica <service>-1 (see node.testcontainers.org/features/compose)
const CONTAINER_WEBSERVER = "webserver-1";

// Port 9 (discard) typically has no listener; connection refused immediately. RFC 6761 .invalid TLD alternative would DNS-fail.
const UNREACHABLE_URL = "http://127.0.0.1:9";

const httpLayer = Http.FetchHttpClient.layer;

/** Load PDF fixtures via Effect FileSystem. Run in beforeAll. */
function loadPdfFixtures() {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pathApi = yield* Path.Path;
		const base = pathApi.join(process.cwd(), "test", "fixtures");
		const [MINIMAL_PDF, MINIMAL_PDF_2, MINIMAL_PDF_3, MINIMAL_PDF_4] = yield* Effect.all([
			fs.readFile(pathApi.join(base, "minimal.pdf")),
			fs.readFile(pathApi.join(base, "minimal2.pdf")),
			fs.readFile(pathApi.join(base, "minimal3.pdf")),
			fs.readFile(pathApi.join(base, "minimal4.pdf")),
		]);
		return { MINIMAL_PDF, MINIMAL_PDF_2, MINIMAL_PDF_3, MINIMAL_PDF_4 };
	});
}

function paperlessTestLayer(
	baseUrl: string,
	token: string,
): Layer.Layer<PaperlessClient, never, never> {
	return Layer.mergeAll(
		TestBaseLayer,
		PaperlessClient.live(baseUrl, token).pipe(Layer.provide(httpLayer)),
	);
}

/** Upload document then run poll effect. Use when test only needs upload + poll. */
function uploadThenPoll<T, E>(
	content: Uint8Array,
	filename: string,
	tags: ReadonlyArray<ReturnType<typeof toTagName>>,
	poll: Effect.Effect<T, E>,
): Effect.Effect<T, E | DomainError, PaperlessClient> {
	return Effect.gen(function* () {
		const paperless = yield* PaperlessClient;
		yield* paperless.uploadDocument(content, filename, [...tags]);
		return yield* poll;
	});
}

/** Asserts exit is failure with PaperlessApiError, returns the error for further assertions. */
function expectUploadFailure(exit: Exit.Exit<unknown, unknown>): PaperlessApiError {
	expect(Exit.isFailure(exit)).toBe(true);
	const err = Option.getOrUndefined(Exit.findErrorOption(exit));
	expect(err).toBeDefined();
	if (!(err instanceof PaperlessApiError)) throw new Error("expected PaperlessApiError");
	return err;
}

describe.skipIf(!runPaperlessApiIntegrationTest)("paperless-api integration", () => {
	let environment: StartedDockerComposeEnvironment;
	let baseUrl: string;
	let token: string;
	let MINIMAL_PDF: Uint8Array;
	let MINIMAL_PDF_2: Uint8Array;
	let MINIMAL_PDF_3: Uint8Array;
	let MINIMAL_PDF_4: Uint8Array;

	beforeAll(async () => {
		const fixtures = await Effect.runPromise(
			loadPdfFixtures().pipe(Effect.provide(PlatformServicesLayer)),
		);
		MINIMAL_PDF = fixtures.MINIMAL_PDF;
		MINIMAL_PDF_2 = fixtures.MINIMAL_PDF_2;
		MINIMAL_PDF_3 = fixtures.MINIMAL_PDF_3;
		MINIMAL_PDF_4 = fixtures.MINIMAL_PDF_4;

		// Cold-start in CI: pull 5 images + postgres/redis/gotenberg/tika + paperless migrations. 8 min accommodates first run.
		environment = await new DockerComposeEnvironment(COMPOSE_DIR, COMPOSE_FILE)
			.withEnvironmentFile(ENV_INTEGRATION_TESTS)
			.withWaitStrategy(CONTAINER_WEBSERVER, Wait.forHttp("/", 8000).forStatusCode(302))
			.withStartupTimeout(480_000)
			.up([...SERVICES]);

		const container = environment.getContainer(CONTAINER_WEBSERVER);
		baseUrl = `http://${container.getHost()}:${container.getMappedPort(8000)}`;
		token = await Effect.runPromise(
			apiPostToken(baseUrl, { PAPERLESS_ADMIN_USER, PAPERLESS_ADMIN_PASSWORD }),
		);
	}, 600_000);

	afterAll(async () => {
		await environment?.down();
	}, 60_000);

	/** Run a PaperlessClient Effect with the test layer. Overrides use custom baseUrl/token. */
	const runPaperlessTest = <A, E>(
		program: Effect.Effect<A, E, PaperlessClient>,
		ctx?: { baseUrl?: string; token?: string },
	) =>
		Effect.runPromise(
			program.pipe(
				Effect.provide(paperlessTestLayer(ctx?.baseUrl ?? baseUrl, ctx?.token ?? token)),
			),
		);

	/** Run program with Effect.exit, for failure tests. */
	const runPaperlessTestExit = <A, E>(
		program: Effect.Effect<A, E, PaperlessClient>,
		ctx?: { baseUrl?: string; token?: string },
	) =>
		Effect.runPromise(
			Effect.exit(program).pipe(
				Effect.provide(paperlessTestLayer(ctx?.baseUrl ?? baseUrl, ctx?.token ?? token)),
			),
		);

	it("returns empty documents list on fresh instance", async () => {
		const listBody = await Effect.runPromise(apiGetDocuments(baseUrl, token));
		expect(listBody.count).toBe(0);
		expect(listBody.results?.length ?? 0).toBe(0);
	}, 15_000);

	it("uploads document and resolves tags", async () => {
		const result = await runPaperlessTest(
			Effect.gen(function* () {
				const paperless = yield* PaperlessClient;
				yield* paperless.uploadDocument(MINIMAL_PDF, "test-doc.pdf", [
					toTagName("signal-test"),
					toTagName("live-integration"),
				]);

				const signalTagBody = yield* apiGetTags(baseUrl, "signal-test", token);
				const liveTagBody = yield* apiGetTags(baseUrl, "live-integration", token);
				const docList = yield* pollUntilDocumentWithTag(baseUrl, token, "signal-test");
				return { signalTagBody, liveTagBody, docList };
			}),
		);

		expect(result.signalTagBody.results?.length).toBe(1);
		expect(result.liveTagBody.results?.length).toBe(1);
		const signalTagId = result.signalTagBody.results?.[0]?.id ?? 0;
		const liveTagId = result.liveTagBody.results?.[0]?.id ?? 0;
		expect(result.docList.results?.length ?? 0).toBeGreaterThanOrEqual(1);
		const doc = result.docList.results?.[0];
		expect(doc?.id).toBeGreaterThan(0);
		expect(doc?.original_file_name).toBe("test-doc.pdf");
		expect(doc?.tags).toBeDefined();
		expect(doc?.tags).toHaveLength(2);
		expect(doc?.tags).toContain(signalTagId);
		expect(doc?.tags).toContain(liveTagId);
	}, 60_000);

	it("creates new tag when not found", async () => {
		const uniqueTag = `live-integration-${Date.now()}`;

		const result = await runPaperlessTest(
			Effect.gen(function* () {
				const paperless = yield* PaperlessClient;
				yield* paperless.uploadDocument(MINIMAL_PDF_2, "tag-test.pdf", [toTagName(uniqueTag)]);

				const tagsBody = yield* apiGetTags(baseUrl, uniqueTag, token);
				const tag = tagsBody.results?.[0];
				if (tag === undefined) return yield* Effect.fail(new Error("tag not found"));
				const docList = yield* pollUntilDocumentWithTagId(baseUrl, token, tag.id);
				return { tag, docList };
			}),
		);

		expect(result.tag).toMatchObject({ name: uniqueTag });
		expect(result.docList.results?.length ?? 0).toBeGreaterThanOrEqual(1);
		expect(result.docList.results?.[0]?.id).toBeGreaterThan(0);
	}, 60_000);

	it("uploads document with zero tags", async () => {
		const filename = "no-tags.pdf";

		const docList = await runPaperlessTest(
			uploadThenPoll(
				MINIMAL_PDF_3,
				filename,
				[],
				pollUntilDocumentWithFilename(baseUrl, token, filename),
			),
		);

		const doc = findDocByFilename(docList, filename);
		expect(doc).toBeDefined();
		expect(doc?.id).toBeGreaterThan(0);
		expect(doc?.tags ?? []).toHaveLength(0);
	}, 60_000);

	it("reuses existing tag when found", async () => {
		// signal-test exists from "uploads document" — tests GET path, no POST
		const filename = "reuse-tag.pdf";

		const docList = await runPaperlessTest(
			uploadThenPoll(
				MINIMAL_PDF_4,
				filename,
				[toTagName("signal-test")],
				pollUntilDocumentWithFilename(baseUrl, token, filename),
			),
		);

		const doc = findDocByFilename(docList, filename);
		expect(doc).toBeDefined();
		expect(doc?.id).toBeGreaterThan(0);
		expect(doc?.tags?.length ?? 0).toBeGreaterThanOrEqual(1);
	}, 60_000);

	it("token endpoint rejects invalid credentials", async () => {
		const exit = await runWithExit(
			apiPostToken(baseUrl, {
				PAPERLESS_ADMIN_USER,
				PAPERLESS_ADMIN_PASSWORD: "wrong-password",
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	}, 15_000);

	it("polling times out when document never appears", async () => {
		const invalidPdf = new Uint8Array([1, 2, 3]); // Not a valid PDF; consumption fails

		await expect(
			runPaperlessTest(
				uploadThenPoll(
					invalidPdf,
					"invalid.pdf",
					[toTagName("never-appears")],
					pollUntilDocumentWithTag(baseUrl, token, "never-appears", {
						maxAttempts: 2,
						intervalMs: 1000,
					}),
				),
			),
		).rejects.toThrow(/did not appear after 2 attempts/);
	}, 15_000);

	it("fails with invalid token", async () => {
		const status = await Effect.runPromise(
			apiGetStatus(baseUrl, "/api/documents/", "invalid-token"),
		);

		const uploadExit = await runPaperlessTestExit(
			Effect.gen(function* () {
				const paperless = yield* PaperlessClient;
				yield* paperless.uploadDocument(new Uint8Array([1, 2, 3]), "bad.pdf", [toTagName("test")]);
			}),
			{ token: "invalid-token" },
		);

		expect(status).toBe(401);
		const err = expectUploadFailure(uploadExit);
		expect([401, 0]).toContain(err.status);
		expect(err.message).toBeTruthy();
	}, 15_000);

	it("handles unreachable URL", async () => {
		const exit = await runPaperlessTestExit(
			Effect.gen(function* () {
				const paperless = yield* PaperlessClient;
				yield* paperless.uploadDocument(new Uint8Array([1]), "x.pdf", [toTagName("test")]);
			}),
			{ baseUrl: UNREACHABLE_URL, token: "any-token" },
		);

		const err = expectUploadFailure(exit);
		expect(err.status).toBe(0);
		expect(err.message).toBeTruthy();
	}, 15_000);
});
