import { Effect, Exit, Option, Redacted } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import type { SignalNumber } from "../src/domain/signal-types.js";
import type { EmailLabel } from "../src/domain/types.js";
import {
	DEFAULT_CONFIG_PATH,
	EmailConfig,
	resolveConfigPath,
	SignalConfig,
	type SignalConfigService,
} from "../src/shell/config.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import { createTestTempDir, SilentLoggerLayer } from "./test-utils.js";

const minimalSignalConfig = {
	consume_dir: "/tmp/consume",
	email_accounts_path: "/tmp/email-accounts.json",
	signal_api_url: "http://localhost:8080",
	ingest_users_path: "/tmp/ingest-users.json",
	webhook_host: "127.0.0.1",
	webhook_port: 8089,
};

const minimalEmailConfig = {
	...minimalSignalConfig,
	ollama_url: "http://localhost:11434",
	ollama_vision_model: "llava",
	ollama_text_model: "llama2",
	page_size: 50,
};

async function runSignalConfigLayer(path: string): Promise<SignalConfigService> {
	const program = Effect.gen(function* () {
		return yield* SignalConfig;
	}).pipe(
		Effect.provide(SignalConfig.layer(path)),
		Effect.provide(PlatformServicesLayer),
		Effect.provide(SilentLoggerLayer),
	);
	return Effect.runPromise(program);
}

async function runEmailConfigLayer(path: string) {
	const program = Effect.gen(function* () {
		return yield* EmailConfig;
	}).pipe(
		Effect.provide(EmailConfig.layer(path)),
		Effect.provide(PlatformServicesLayer),
		Effect.provide(SilentLoggerLayer),
	);
	return Effect.runPromise(program);
}

describe("resolveConfigPath", () => {
	const origEnv = process.env.PAPERLESS_INGESTION_CONFIG;
	afterEach(() => {
		if (origEnv !== undefined) process.env.PAPERLESS_INGESTION_CONFIG = origEnv;
		else delete process.env.PAPERLESS_INGESTION_CONFIG;
	});

	test("returns cli path when provided", () => {
		expect(resolveConfigPath("/custom/path.json")).toBe("/custom/path.json");
	});

	test("returns env when cli path undefined", () => {
		process.env.PAPERLESS_INGESTION_CONFIG = "/env/path.json";
		expect(resolveConfigPath(undefined)).toBe("/env/path.json");
	});

	test("returns default when both undefined", () => {
		delete process.env.PAPERLESS_INGESTION_CONFIG;
		expect(resolveConfigPath(undefined)).toBe(DEFAULT_CONFIG_PATH);
	});
});

async function expectMissingFileFails(
	run: (path: string) => Promise<unknown>,
	_prefix: string,
): Promise<void> {
	const tmp = await createTestTempDir();
	const badPath = tmp.join("nonexistent.json");
	const err = await run(badPath).catch((e) => e);
	expect(err).toMatchObject({
		_tag: "ConfigParseError",
		message: "Config file not found",
	});
	expect(Redacted.value((err as { path: Redacted.Redacted<string> }).path)).toBe(badPath);
	await tmp.remove();
}

describe("buildSignalConfigLayer", () => {
	test("missing file fails with ConfigParseError", async () => {
		await expectMissingFileFails(runSignalConfigLayer, "config-missing-");
	});

	test("invalid JSON fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		await tmp.writeFile(path, "not valid json {");

		const program = Effect.gen(function* () {
			return yield* SignalConfig;
		}).pipe(
			Effect.provide(SignalConfig.layer(path)),
			Effect.provide(PlatformServicesLayer),
			Effect.provide(SilentLoggerLayer),
		);
		const exit = await Effect.runPromise(Effect.exit(program));
		const errOpt = Exit.findErrorOption(exit);
		expect(Option.isSome(errOpt)).toBe(true);
		const err = (
			errOpt as Option.Some<{ _tag: string; path: Redacted.Redacted<string>; message?: string }>
		).value;
		expect(err).toMatchObject({ _tag: "ConfigParseError" });
		expect(Redacted.value(err.path)).toBe(path);
		expect(err.message).toContain("Invalid JSON or config schema");
		await tmp.remove();
	});

	test("valid JSON but missing required field fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		await tmp.writeFile(
			path,
			JSON.stringify({
				...minimalSignalConfig,
				webhook_host: undefined,
			}),
		);

		const err = await runSignalConfigLayer(path).catch((e) => e);
		expect(err).toMatchObject({ _tag: "ConfigParseError" });
		expect(Redacted.value((err as { path: Redacted.Redacted<string> }).path)).toBe(path);
		await tmp.remove();
	});

	test("missing ingest_users_path fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		await tmp.writeFile(
			path,
			JSON.stringify({
				...minimalSignalConfig,
				ingest_users_path: undefined,
			}),
		);

		const err = await runSignalConfigLayer(path).catch((e) => e);
		expect(err).toMatchObject({ _tag: "ConfigParseError" });
		expect(Redacted.value((err as { path: Redacted.Redacted<string> }).path)).toBe(path);
		await tmp.remove();
	});

	test("ingest_users_path loads registry from file", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("ingest-users.json");
		await tmp.writeFile(
			configPath,
			JSON.stringify({
				...minimalSignalConfig,
				ingest_users_path: usersPath,
			}),
		);
		await tmp.writeFile(
			usersPath,
			JSON.stringify([
				{
					slug: "user1",
					signal_number: "+15550000001",
					consume_subdir: "u1",
					display_name: "User 1",
					tag_name: "User 1",
				},
				{
					slug: "user2",
					signal_number: "+15550000002",
					consume_subdir: "u2",
					display_name: "User 2",
					tag_name: "User 2",
				},
			]),
		);

		const config = await runSignalConfigLayer(configPath);
		expect(config.registry.users).toHaveLength(2);
		expect(config.registry.findBySignal("+15550000001" as SignalNumber)).toMatchObject({
			slug: "user1",
			consumeSubdir: "u1",
			displayName: "User 1",
		});
		expect(config.registry.findBySignal("+15550000002" as SignalNumber)).toMatchObject({
			slug: "user2",
			consumeSubdir: "u2",
		});
		await tmp.remove();
	});

	test("missing ingest-users.json fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		const usersPath = tmp.join("nonexistent-users.json");
		await tmp.writeFile(
			path,
			JSON.stringify({
				...minimalSignalConfig,
				ingest_users_path: usersPath,
			}),
		);

		const err = await runSignalConfigLayer(path).catch((e) => e);
		expect(err).toMatchObject({
			_tag: "ConfigParseError",
			message: "Ingest users file does not exist",
		});
		expect(Redacted.value((err as { path: Redacted.Redacted<string> }).path)).toBe(usersPath);
		await tmp.remove();
	});

	test("invalid port fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		await tmp.writeFile(
			path,
			JSON.stringify({
				...minimalSignalConfig,
				webhook_port: 99999,
			}),
		);

		const err = await runSignalConfigLayer(path).catch((e) => e);
		expect(err).toMatchObject({ _tag: "ConfigParseError" });
		expect(Redacted.value((err as { path: Redacted.Redacted<string> }).path)).toBe(path);
		await tmp.remove();
	});

	test("valid config succeeds", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		const usersPath = tmp.join("ingest-users.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(
			path,
			JSON.stringify({
				...minimalSignalConfig,
				ingest_users_path: usersPath,
			}),
		);

		const config = await runSignalConfigLayer(path);
		expect(config).toMatchObject({
			consumeDir: "/tmp/consume",
			emailAccountsPath: "/tmp/email-accounts.json",
			signalApiUrl: "http://localhost:8080",
			logLevel: "INFO",
			host: "127.0.0.1",
			port: 8089,
		});
		expect(config.registry.users).toHaveLength(0);
		await tmp.remove();
	});
});

describe("buildEmailConfigLayer", () => {
	test("missing file fails with ConfigParseError", async () => {
		await expectMissingFileFails(runEmailConfigLayer, "config-email-missing-");
	});

	test("valid config succeeds with schema defaults", async () => {
		const tmp = await createTestTempDir();
		const path = tmp.join("config.json");
		const usersPath = tmp.join("ingest-users.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(
			path,
			JSON.stringify({
				...minimalEmailConfig,
				ingest_users_path: usersPath,
			}),
		);

		const config = await runEmailConfigLayer(path);
		expect(config).toMatchObject({
			consumeDir: "/tmp/consume",
			logLevel: "INFO",
			markProcessedLabel: "paperless" as EmailLabel,
			pageSize: 50,
		});
		await tmp.remove();
	});
});
