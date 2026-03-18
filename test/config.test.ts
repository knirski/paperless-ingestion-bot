import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { SignalNumber } from "../src/domain/signal-types.js";
import type { EmailLabel } from "../src/domain/types.js";
import {
	DEFAULT_CONFIG_PATH,
	DEFAULT_EMAIL_ACCOUNTS_PATH,
	DEFAULT_USERS_PATH,
	EmailConfig,
	resolveConfigPath,
	resolveEmailAccountsPath,
	resolveUsersPath,
	SignalConfig,
	type SignalConfigService,
} from "../src/shell/config.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import { createTestTempDir, SilentLoggerLayer } from "./test-utils.js";

const minimalSignalConfig = {
	consume_dir: "/tmp/consume",
	signal_api_url: "http://localhost:8080",
	webhook_host: "127.0.0.1",
	webhook_port: 8089,
};

const minimalEmailConfig = {
	...minimalSignalConfig,
	ollama_url: "http://localhost:11434",
	ollama_vision_model: "llava",
	ollama_text_model: "llama2",
	page_size: 50,
	credential_failure_throttle_hours: 24,
};

async function runSignalConfigLayer(
	configPath: string,
	usersPath: string,
	emailAccountsPath: string,
): Promise<SignalConfigService> {
	const program = Effect.gen(function* () {
		return yield* SignalConfig;
	}).pipe(
		Effect.provide(SignalConfig.layer(configPath, usersPath, emailAccountsPath)),
		Effect.provide(PlatformServicesLayer),
		Effect.provide(SilentLoggerLayer),
	);
	return Effect.runPromise(program);
}

async function runEmailConfigLayer(
	configPath: string,
	usersPath: string,
	emailAccountsPath: string,
) {
	const program = Effect.gen(function* () {
		return yield* EmailConfig;
	}).pipe(
		Effect.provide(EmailConfig.layer(configPath, usersPath, emailAccountsPath)),
		Effect.provide(PlatformServicesLayer),
		Effect.provide(SilentLoggerLayer),
	);
	return Effect.runPromise(program);
}

describe("resolveConfigPath", () => {
	test("returns cli path when provided", () => {
		expect(resolveConfigPath("/custom/path.json")).toBe("/custom/path.json");
	});

	test("returns env when cli path undefined and env set", () => {
		const orig = process.env.PAPERLESS_INGESTION_CONFIG;
		process.env.PAPERLESS_INGESTION_CONFIG = "/env/config.json";
		try {
			expect(resolveConfigPath(undefined)).toBe("/env/config.json");
		} finally {
			if (orig !== undefined) process.env.PAPERLESS_INGESTION_CONFIG = orig;
			else delete process.env.PAPERLESS_INGESTION_CONFIG;
		}
	});

	test("returns default when cli path undefined and no env", () => {
		const orig = process.env.PAPERLESS_INGESTION_CONFIG;
		delete process.env.PAPERLESS_INGESTION_CONFIG;
		try {
			expect(resolveConfigPath(undefined)).toBe(DEFAULT_CONFIG_PATH);
		} finally {
			if (orig !== undefined) process.env.PAPERLESS_INGESTION_CONFIG = orig;
		}
	});
});

describe("resolveUsersPath", () => {
	test("returns cli path when provided", () => {
		expect(resolveUsersPath("/custom/users.json")).toBe("/custom/users.json");
	});

	test("returns env when cli path undefined and env set", () => {
		const orig = process.env.PAPERLESS_INGESTION_USERS_PATH;
		process.env.PAPERLESS_INGESTION_USERS_PATH = "/env/users.json";
		try {
			expect(resolveUsersPath(undefined)).toBe("/env/users.json");
		} finally {
			if (orig !== undefined) process.env.PAPERLESS_INGESTION_USERS_PATH = orig;
			else delete process.env.PAPERLESS_INGESTION_USERS_PATH;
		}
	});

	test("returns default when cli path undefined and no env", () => {
		const orig = process.env.PAPERLESS_INGESTION_USERS_PATH;
		delete process.env.PAPERLESS_INGESTION_USERS_PATH;
		try {
			expect(resolveUsersPath(undefined)).toBe(DEFAULT_USERS_PATH);
		} finally {
			if (orig !== undefined) process.env.PAPERLESS_INGESTION_USERS_PATH = orig;
		}
	});
});

describe("resolveEmailAccountsPath", () => {
	test("returns cli path when provided", () => {
		expect(resolveEmailAccountsPath("/custom/email-accounts.json")).toBe(
			"/custom/email-accounts.json",
		);
	});

	test("returns env when cli path undefined and env set", () => {
		const orig = process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH;
		process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH = "/env/email-accounts.json";
		try {
			expect(resolveEmailAccountsPath(undefined)).toBe("/env/email-accounts.json");
		} finally {
			if (orig !== undefined) process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH = orig;
			else delete process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH;
		}
	});

	test("returns default when cli path undefined and no env", () => {
		const orig = process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH;
		delete process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH;
		try {
			expect(resolveEmailAccountsPath(undefined)).toBe(DEFAULT_EMAIL_ACCOUNTS_PATH);
		} finally {
			if (orig !== undefined) process.env.PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH = orig;
		}
	});
});

async function expectMissingConfigFileFails(
	run: (configPath: string, usersPath: string, emailAccountsPath: string) => Promise<unknown>,
): Promise<void> {
	const tmp = await createTestTempDir();
	const badPath = tmp.join("nonexistent.json");
	await expect(
		run(badPath, tmp.join("users.json"), tmp.join("email-accounts.json")),
	).rejects.toMatchObject({
		_tag: "ConfigParseError",
		message: "Config file not found",
	});
	await tmp.remove();
}

describe("buildSignalConfigLayer", () => {
	test("missing config file fails with ConfigParseError", async () => {
		await expectMissingConfigFileFails(runSignalConfigLayer);
	});

	test("invalid JSON fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(configPath, "not valid json {");
		await tmp.writeFile(usersPath, "[]");

		const err = await runSignalConfigLayer(configPath, usersPath, emailAccountsPath).catch(
			(e: unknown) => e,
		);
		expect(err).toMatchObject({ _tag: "ConfigParseError" });
		expect((err as { message?: string }).message).toMatch(
			/Invalid JSON|Invalid JSON or config schema/,
		);
		await tmp.remove();
	});

	test("valid JSON but missing required field fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(
			configPath,
			JSON.stringify({
				...minimalSignalConfig,
				webhook_host: undefined,
			}),
		);

		await expect(
			runSignalConfigLayer(configPath, usersPath, emailAccountsPath),
		).rejects.toMatchObject({
			_tag: "ConfigParseError",
		});
		await tmp.remove();
	});

	test("usersPath loads registry from file", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(configPath, JSON.stringify(minimalSignalConfig));
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

		const config = await runSignalConfigLayer(configPath, usersPath, emailAccountsPath);
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

	test("missing users.json fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("nonexistent-users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(configPath, JSON.stringify(minimalSignalConfig));

		await expect(
			runSignalConfigLayer(configPath, usersPath, emailAccountsPath),
		).rejects.toMatchObject({
			_tag: "ConfigParseError",
			message: "Users file does not exist",
		});
		await tmp.remove();
	});

	test("invalid port fails with ConfigParseError", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(
			configPath,
			JSON.stringify({
				...minimalSignalConfig,
				webhook_port: 99999,
			}),
		);

		await expect(
			runSignalConfigLayer(configPath, usersPath, emailAccountsPath),
		).rejects.toMatchObject({
			_tag: "ConfigParseError",
		});
		await tmp.remove();
	});

	test("valid config succeeds", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(configPath, JSON.stringify(minimalSignalConfig));

		const config = await runSignalConfigLayer(configPath, usersPath, emailAccountsPath);
		expect(config).toMatchObject({
			consumeDir: "/tmp/consume",
			emailAccountsPath,
			signalApiUrl: "http://localhost:8080",
			logLevel: "INFO",
			host: "127.0.0.1",
			port: 8089,
		});
		expect(config.registry.users).toHaveLength(0);
		await tmp.remove();
	});
});

describe("env var overrides", () => {
	const origSignalApiUrl = process.env.PAPERLESS_INGESTION_SIGNAL_API_URL;
	afterEach(() => {
		if (origSignalApiUrl !== undefined)
			process.env.PAPERLESS_INGESTION_SIGNAL_API_URL = origSignalApiUrl;
		else delete process.env.PAPERLESS_INGESTION_SIGNAL_API_URL;
	});

	test("PAPERLESS_INGESTION_SIGNAL_API_URL overrides file value", async () => {
		const tmp = await createTestTempDir("config-env-override-");
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(
			configPath,
			JSON.stringify({
				...minimalSignalConfig,
				signal_api_url: "http://file-value:8080",
			}),
		);
		process.env.PAPERLESS_INGESTION_SIGNAL_API_URL = "http://env-override:9090";
		try {
			const config = await runSignalConfigLayer(configPath, usersPath, emailAccountsPath);
			expect(config.signalApiUrl).toBe("http://env-override:9090");
		} finally {
			await tmp.remove();
		}
	});
});

describe("buildEmailConfigLayer", () => {
	test("missing config file fails with ConfigParseError", async () => {
		await expectMissingConfigFileFails(runEmailConfigLayer);
	});

	test("valid config succeeds with schema defaults", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(configPath, JSON.stringify(minimalEmailConfig));

		const config = await runEmailConfigLayer(configPath, usersPath, emailAccountsPath);
		expect(config).toMatchObject({
			consumeDir: "/tmp/consume",
			logLevel: "INFO",
			markProcessedLabel: "paperless" as EmailLabel,
			pageSize: 50,
			credentialFailureThrottleHours: 24,
		});
		await tmp.remove();
	});

	test("credential_failure_throttle_hours defaults to 24 when omitted", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		const { credential_failure_throttle_hours: _, ...configWithoutThrottle } = minimalEmailConfig;
		await tmp.writeFile(configPath, JSON.stringify(configWithoutThrottle));

		const config = await runEmailConfigLayer(configPath, usersPath, emailAccountsPath);
		expect(config.credentialFailureThrottleHours).toBe(24);
		await tmp.remove();
	});

	test("credential_failure_throttle_hours respects custom value", async () => {
		const tmp = await createTestTempDir();
		const configPath = tmp.join("config.json");
		const usersPath = tmp.join("users.json");
		const emailAccountsPath = tmp.join("email-accounts.json");
		await tmp.writeFile(usersPath, "[]");
		await tmp.writeFile(
			configPath,
			JSON.stringify({ ...minimalEmailConfig, credential_failure_throttle_hours: 12 }),
		);

		const config = await runEmailConfigLayer(configPath, usersPath, emailAccountsPath);
		expect(config.credentialFailureThrottleHours).toBe(12);
		await tmp.remove();
	});
});
