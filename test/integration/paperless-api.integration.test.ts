/**
 * Optional live Paperless API test. Skips when PAPERLESS_API_INTEGRATION_TEST is not set.
 * Requires Docker. Runs real paperless-ngx via Testcontainers.
 *
 * Uses beforeAll/afterAll for compose lifecycle so we can split into multiple it() blocks.
 * API responses decoded via HttpClient + Schema (filterStatusOk, schemaBodyJson).
 *
 * **API version:** Same as production — see README Config (Paperless API version contract).
 *
 * Run with:
 *   PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join as pathJoin } from "node:path";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import * as Http from "effect/unstable/http";
import {
	DockerComposeEnvironment,
	type StartedDockerComposeEnvironment,
	Wait,
} from "testcontainers";
import { PaperlessApiError } from "../../src/domain/errors.js";
import { toTagName } from "../../src/domain/paperless-types.js";
import { PAPERLESS_NGX_ACCEPT_VERSION, PaperlessClient } from "../../src/live/paperless-client.js";
import { runWithLayer, TestBaseLayer } from "../test-utils.js";

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

// Schemas for Paperless API responses
const TokenResponseSchema = Schema.Struct({ token: Schema.String });
const DocumentListSchema = Schema.Struct({
	results: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.Number }))),
});
const TagsListSchema = Schema.Struct({
	results: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String }))),
});

const httpLayer = Http.FetchHttpClient.layer;

const PAPERLESS_ACCEPT = `application/json; version=${PAPERLESS_NGX_ACCEPT_VERSION}`;

type PaperlessAuthHeaders = {
	Authorization: string;
	Accept: string;
};

function paperlessAuthHeaders(token: string): PaperlessAuthHeaders {
	return {
		Authorization: `Token ${token}`,
		Accept: PAPERLESS_ACCEPT,
	};
}

type PaperlessApiRequestError = Http.HttpClientError.HttpClientError | Schema.SchemaError;

function apiUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

const API_JSON_HEADERS: { "Content-Type": string; Accept: string } = {
	"Content-Type": "application/json",
	Accept: PAPERLESS_ACCEPT,
};

function apiGetDocuments(
	baseUrl: string,
	token: string,
): Effect.Effect<Schema.Schema.Type<typeof DocumentListSchema>, PaperlessApiRequestError, never> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const res = yield* client.get(apiUrl(baseUrl, "/api/documents/"), {
			headers: paperlessAuthHeaders(token),
		});
		return yield* Http.HttpClientResponse.filterStatusOk(res).pipe(
			Effect.flatMap(Http.HttpClientResponse.schemaBodyJson(DocumentListSchema)),
		);
	}).pipe(Effect.provide(httpLayer));
}

function apiGetTags(
	baseUrl: string,
	nameFilter: string,
	token: string,
): Effect.Effect<Schema.Schema.Type<typeof TagsListSchema>, PaperlessApiRequestError, never> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const res = yield* client.get(
			apiUrl(baseUrl, `/api/tags/?name__iexact=${encodeURIComponent(nameFilter)}`),
			{ headers: paperlessAuthHeaders(token) },
		);
		return yield* Http.HttpClientResponse.filterStatusOk(res).pipe(
			Effect.flatMap(Http.HttpClientResponse.schemaBodyJson(TagsListSchema)),
		);
	}).pipe(Effect.provide(httpLayer));
}

type TokenCredentials = { PAPERLESS_ADMIN_USER: string; PAPERLESS_ADMIN_PASSWORD: string };

function apiPostToken(
	baseUrl: string,
	creds: TokenCredentials,
): Effect.Effect<string, PaperlessApiRequestError, never> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const res = yield* client.post(apiUrl(baseUrl, "/api/token/"), {
			headers: API_JSON_HEADERS,
			body: Http.HttpBody.jsonUnsafe({
				username: creds.PAPERLESS_ADMIN_USER,
				password: creds.PAPERLESS_ADMIN_PASSWORD,
			}),
		});
		const body = yield* Http.HttpClientResponse.filterStatusOk(res).pipe(
			Effect.flatMap(Http.HttpClientResponse.schemaBodyJson(TokenResponseSchema)),
		);
		return body.token;
	}).pipe(Effect.provide(httpLayer));
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

	beforeAll(async () => {
		environment = await new DockerComposeEnvironment(COMPOSE_DIR, COMPOSE_FILE)
			.withEnvironmentFile(ENV_INTEGRATION_TESTS)
			.withWaitStrategy(CONTAINER_WEBSERVER, Wait.forHttp("/api/", 8000).forStatusCode(200))
			.withStartupTimeout(180_000)
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

	it("uploads document and resolves tags", async () => {
		const run = runWithLayer(paperlessTestLayer(baseUrl, token));
		const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");

		await run(
			Effect.gen(function* () {
				const paperless = yield* PaperlessClient;
				yield* paperless.uploadDocument(pdfBytes, "test-doc.pdf", [
					toTagName("signal-test"),
					toTagName("live-integration"),
				]);
			}).pipe(Effect.asVoid),
		);

		const listBody = await Effect.runPromise(apiGetDocuments(baseUrl, token));
		expect(listBody.results?.length ?? 0).toBeGreaterThanOrEqual(1);
	}, 60_000);

	it("creates new tag when not found", async () => {
		const uniqueTag = `live-integration-${Date.now()}`;
		const run = runWithLayer(paperlessTestLayer(baseUrl, token));
		const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");

		await run(
			Effect.gen(function* () {
				const paperless = yield* PaperlessClient;
				yield* paperless.uploadDocument(pdfBytes, "tag-test.pdf", [toTagName(uniqueTag)]);
			}).pipe(Effect.asVoid),
		);

		const tagsBody = await Effect.runPromise(apiGetTags(baseUrl, uniqueTag, token));
		expect(tagsBody.results?.length).toBe(1);
		expect(tagsBody.results?.[0]).toMatchObject({ name: uniqueTag });
	}, 60_000);

	it("fails with invalid token", async () => {
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(new Uint8Array([1, 2, 3]), "bad.pdf", [toTagName("test")]);
		}).pipe(Effect.asVoid, Effect.provide(paperlessTestLayer(baseUrl, "invalid-token")));

		const exit = await Effect.runPromise(Effect.exit(program));
		expect(expectUploadFailure(exit).status).toBe(401);
	}, 15_000);

	it("handles unreachable URL", async () => {
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(new Uint8Array([1]), "x.pdf", [toTagName("test")]);
		}).pipe(Effect.asVoid, Effect.provide(paperlessTestLayer(UNREACHABLE_URL, "any-token")));

		const err = expectUploadFailure(await Effect.runPromise(Effect.exit(program)));
		expect(err.status).toBe(0);
		expect(err.message).toBeTruthy();
	}, 15_000);
});
