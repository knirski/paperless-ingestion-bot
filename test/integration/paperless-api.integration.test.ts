/**
 * Optional live Paperless API test. Skips when PAPERLESS_API_INTEGRATION_TEST is not set.
 * Requires Docker. Runs real paperless-ngx via Testcontainers.
 *
 * Run with:
 *   PAPERLESS_API_INTEGRATION_TEST=1 bun run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { Effect, Exit, Layer, Option } from "effect";
import * as Http from "effect/unstable/http";
import {
	DockerComposeEnvironment,
	type StartedDockerComposeEnvironment,
	Wait,
} from "testcontainers";
import type { DomainError } from "../../src/domain/errors.js";
import { PaperlessApiError } from "../../src/domain/errors.js";
import { toTagName } from "../../src/domain/paperless-types.js";
import { PaperlessClient } from "../../src/live/paperless-client.js";
import { TestBaseLayer } from "../test-utils.js";
import { paperlessTestEnv } from "./paperless-api-integration-env.js";

const runPaperlessApiLiveTest = process.env.PAPERLESS_API_INTEGRATION_TEST === "1";

const COMPOSE_DIR = pathJoin(process.cwd(), "deploy", "compose");
const COMPOSE_FILE = "docker-compose.full-stack.yml";
const COMPOSE_ENV = pathJoin(COMPOSE_DIR, "docker-compose.env");
const COMPOSE_TEST_ENV = pathJoin(COMPOSE_DIR, "docker-compose.test.env");
const SERVICES = ["broker", "db", "gotenberg", "tika", "webserver"] as const;
const CONTAINER_WEBSERVER = "webserver-1";

async function bootstrapToken(baseUrl: string): Promise<string> {
	const res = await fetch(`${baseUrl}/api/token/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: paperlessTestEnv.PAPERLESS_ADMIN_USER,
			password: paperlessTestEnv.PAPERLESS_ADMIN_PASSWORD,
		}),
	});
	if (!res.ok) throw new Error(`Token bootstrap failed: ${res.status} ${await res.text()}`);
	const json = (await res.json()) as { token: string };
	return json.token;
}

describe.skipIf(!runPaperlessApiLiveTest)("paperless-api live", () => {
	let environment: StartedDockerComposeEnvironment;
	let baseUrl: string;
	let token: string;
	let createdEnvFile = false;

	beforeAll(async () => {
		// Compose requires docker-compose.env. Copy test env so the test runs without user setup.
		if (!existsSync(COMPOSE_ENV)) {
			copyFileSync(COMPOSE_TEST_ENV, COMPOSE_ENV);
			createdEnvFile = true;
		}

		environment = await new DockerComposeEnvironment(COMPOSE_DIR, COMPOSE_FILE)
			.withWaitStrategy(CONTAINER_WEBSERVER, Wait.forHttp("/api/", 8000).forStatusCode(200))
			.withStartupTimeout(180_000)
			.up([...SERVICES]);

		const container = environment.getContainer(CONTAINER_WEBSERVER);
		const host = container.getHost();
		const port = container.getMappedPort(8000);
		baseUrl = `http://${host}:${port}`;
		token = await bootstrapToken(baseUrl);
	}, 600_000);

	afterAll(async () => {
		await environment?.down();
		if (createdEnvFile && existsSync(COMPOSE_ENV)) {
			unlinkSync(COMPOSE_ENV);
		}
	});

	it("uploads document and resolves tags", async () => {
		const layer = Layer.mergeAll(
			TestBaseLayer,
			Http.FetchHttpClient.layer,
			PaperlessClient.live(baseUrl, token),
		);

		const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(pdfBytes, "test-doc.pdf", [
				toTagName("signal-test"),
				toTagName("live-integration"),
			]);
		}).pipe(Effect.provide(layer));

		await Effect.runPromise(program as Effect.Effect<void, DomainError>);

		const listRes = await fetch(`${baseUrl}/api/documents/`, {
			headers: { Authorization: `Token ${token}` },
		});
		expect(listRes.ok).toBe(true);
		const listJson = (await listRes.json()) as { results?: { id: number }[] };
		expect(listJson.results?.length).toBeGreaterThanOrEqual(1);
	}, 30_000);

	it("creates new tag when not found", async () => {
		const uniqueTag = `live-integration-${Date.now()}`;
		const layer = Layer.mergeAll(
			TestBaseLayer,
			Http.FetchHttpClient.layer,
			PaperlessClient.live(baseUrl, token),
		);

		const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(pdfBytes, "tag-test.pdf", [toTagName(uniqueTag)]);
		}).pipe(Effect.provide(layer));

		await Effect.runPromise(program as Effect.Effect<void, DomainError>);

		const tagsRes = await fetch(
			`${baseUrl}/api/tags/?name__iexact=${encodeURIComponent(uniqueTag)}`,
			{ headers: { Authorization: `Token ${token}` } },
		);
		expect(tagsRes.ok).toBe(true);
		const tagsJson = (await tagsRes.json()) as { results?: { id: number; name: string }[] };
		expect(tagsJson.results?.length).toBe(1);
		expect(tagsJson.results?.[0]?.name).toBe(uniqueTag);
	}, 30_000);

	it("fails with invalid token", async () => {
		const layer = Layer.mergeAll(
			TestBaseLayer,
			Http.FetchHttpClient.layer,
			PaperlessClient.live(baseUrl, "invalid-token"),
		);
		const program = Effect.gen(function* () {
			const paperless = yield* PaperlessClient;
			yield* paperless.uploadDocument(new Uint8Array([1, 2, 3]), "bad.pdf", [toTagName("test")]);
		}).pipe(Effect.provide(layer));

		const exit = await Effect.runPromise(
			Effect.exit(program) as Effect.Effect<Exit.Exit<void, DomainError>>,
		);
		expect(Exit.isFailure(exit)).toBe(true);
		const errOpt = Exit.findErrorOption(exit);
		expect(Option.isSome(errOpt)).toBe(true);
		const err = Option.getOrThrow(errOpt);
		expect(err).toBeInstanceOf(PaperlessApiError);
		expect((err as PaperlessApiError).status).toBe(401);
	}, 10_000);
});
