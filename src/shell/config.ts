/**
 * Config service — split config files, Schema-based validation.
 *
 * ## Configuration vs user-generated data
 *
 * **Configuration (infra):** config.json (paths, URLs, webhook, ollama). users.json
 * (user registry). Set by admin. Env vars (PAPERLESS_INGESTION_*) override.
 *
 * **User-generated data:** email-accounts.json (path from --email-accounts or env). Created via `gmail add`.
 *
 * ## File layout (Option 3)
 *
 * - config.json — infra only; path from --config or PAPERLESS_INGESTION_CONFIG
 * - users.json — user registry; path from --users or PAPERLESS_INGESTION_USERS_PATH
 * - email-accounts.json — user-generated; path from --email-accounts or PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH
 *
 * ## Effect ConfigProvider
 *
 * File as base, env vars override via orElse(env, file). Env: nested +
 * constantCase (consume_dir → PAPERLESS_INGESTION_CONSUME_DIR).
 */

import {
	Config,
	ConfigProvider,
	Effect,
	FileSystem,
	Layer,
	type Schedule,
	Schema,
	ServiceMap,
} from "effect";
import { ConfigParseError, FileSystemError } from "../domain/errors.js";
import { SignalNumberSchema } from "../domain/signal-types.js";
import type { UserRegistry } from "../domain/types.js";
import {
	ConsumeSubdirSchema,
	createUserRegistry,
	type EmailLabel,
	EmailLabelSchema,
	type User,
	UserSlugSchema,
} from "../domain/types.js";
import { redactedForLog, redactPath, unknownToMessage } from "../domain/utils.js";
import { mapFsError } from "./fs-utils.js";

/** Log level for config. */
export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Base config shared by Signal and Email pipelines. */
interface BaseConfig {
	readonly consumeDir: string;
	readonly emailAccountsPath: string;
	readonly usersPath: string;
	readonly signalApiUrl: string;
	readonly registry: UserRegistry;
	readonly logLevel: LogLevel;
	readonly markProcessedLabel: EmailLabel;
}

export interface SignalConfigService extends BaseConfig {
	readonly host: string;
	readonly port: number;
}

export class SignalConfig extends ServiceMap.Service<SignalConfig, SignalConfigService>()(
	"paperless-ingestion-bot/shell/config/signal",
) {
	static get layer() {
		return buildSignalConfigLayer;
	}
}

export interface EmailConfigService extends BaseConfig {
	readonly ollamaUrl: string;
	readonly ollamaVisionModel: string;
	readonly ollamaTextModel: string;
	readonly pageSize: number;
	/** Hours between credential failure notifications per email (default 24). */
	readonly credentialFailureThrottleHours: number;
	readonly imapRetrySchedule?: Schedule.Schedule<unknown>;
}

export class EmailConfig extends ServiceMap.Service<EmailConfig, EmailConfigService>()(
	"paperless-ingestion-bot/shell/config/email",
) {
	static get layer() {
		return buildEmailConfigLayer;
	}
}

export const DEFAULT_CONFIG_PATH = "/etc/paperless-ingestion-bot/config.json";
export const DEFAULT_USERS_PATH = "/var/lib/paperless-ingestion-bot/users.json";
export const DEFAULT_EMAIL_ACCOUNTS_PATH = "/var/lib/paperless-ingestion-bot/email-accounts.json";

function resolvePath(cliPath: string | undefined, envKey: string, defaultPath: string): string {
	return cliPath ?? process.env[envKey] ?? defaultPath;
}

/** Resolve config path: --config or env or default. */
export function resolveConfigPath(cliPath: string | undefined): string {
	return resolvePath(cliPath, "PAPERLESS_INGESTION_CONFIG", DEFAULT_CONFIG_PATH);
}

/** Resolve users path: --users or env or default. */
export function resolveUsersPath(cliPath: string | undefined): string {
	return resolvePath(cliPath, "PAPERLESS_INGESTION_USERS_PATH", DEFAULT_USERS_PATH);
}

/** Resolve email accounts path: --email-accounts or env or default. */
export function resolveEmailAccountsPath(cliPath: string | undefined): string {
	return resolvePath(
		cliPath,
		"PAPERLESS_INGESTION_EMAIL_ACCOUNTS_PATH",
		DEFAULT_EMAIL_ACCOUNTS_PATH,
	);
}

/** User entry (users.json). */
const UserSchema = Schema.Struct({
	slug: UserSlugSchema,
	signal_number: SignalNumberSchema,
	consume_subdir: ConsumeSubdirSchema,
	display_name: Schema.String,
	tag_name: Schema.String,
});

type RawUser = Schema.Schema.Type<typeof UserSchema>;

function parseUserRegistry(users: readonly RawUser[]): readonly User[] {
	return users.map((u) => ({
		slug: u.slug,
		signalNumber: u.signal_number,
		consumeSubdir: u.consume_subdir,
		displayName: u.display_name,
		tagName: u.tag_name,
	}));
}

/** Raw shape shared by both config schemas (snake_case from JSON). */
interface RawBaseConfig {
	readonly consume_dir: string;
	readonly signal_api_url: string;
	readonly log_level: LogLevel;
	readonly mark_processed_label: EmailLabel;
}

function toBaseConfig(
	raw: RawBaseConfig,
	registry: UserRegistry,
	usersPath: string,
	emailAccountsPath: string,
): BaseConfig {
	return {
		consumeDir: raw.consume_dir,
		emailAccountsPath,
		usersPath,
		signalApiUrl: raw.signal_api_url,
		registry,
		logLevel: raw.log_level,
		markProcessedLabel: raw.mark_processed_label,
	};
}

/** Infra config base. */
const sharedBase = {
	consume_dir: Schema.String,
	signal_api_url: Schema.String,
	log_level: Schema.Literals(LOG_LEVELS).pipe(Schema.withDecodingDefault(() => "INFO")),
	mark_processed_label: EmailLabelSchema.pipe(
		Schema.withDecodingDefault(() => "paperless" as EmailLabel),
	),
} as const;

const PortSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	Schema.check(Schema.isLessThanOrEqualTo(65535)),
);

export const RawSignalConfigSchema = Schema.Struct({
	...sharedBase,
	webhook_host: Schema.String,
	webhook_port: PortSchema,
});

export const RawEmailConfigSchema = Schema.Struct({
	...sharedBase,
	ollama_url: Schema.String,
	ollama_vision_model: Schema.String,
	ollama_text_model: Schema.String,
	page_size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
		Schema.withDecodingDefault(() => 50),
	),
	credential_failure_throttle_hours: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThanOrEqualTo(1)),
		Schema.withDecodingDefault(() => 24),
	),
});

export function usersHint(path: string): string {
	return `Create ${path} with: [{"slug":"krzysiek","signal_number":"+48...","consume_subdir":"krzysiek","display_name":"Krzysiek","tag_name":"Added by Krzysiek"},...]`;
}

const UsersArraySchema = Schema.Array(UserSchema);
const UsersJsonSchema = Schema.fromJsonString(UsersArraySchema);

const CONFIG_SCHEMA_FIX =
	"Ensure config has required fields: consume_dir, signal_api_url, etc. See README.";
const CONFIG_PARSE_FIX = "Check config file format and required fields. See README.";
const CONFIG_SOURCE_FIX = `Pass --config /path. Default: ${DEFAULT_CONFIG_PATH}`;

function envProvider(): ConfigProvider.ConfigProvider {
	const withTransform = ConfigProvider.fromEnv().pipe(
		ConfigProvider.nested("PAPERLESS_INGESTION"),
		ConfigProvider.constantCase,
	);
	// orElse calls get(), not load(), so nested/constantCase (which run in load) would be skipped.
	// Wrapper: get delegates to load so path transformations apply when orElse consults env.
	return ConfigProvider.make((path) => withTransform.load(path));
}

function configErrorToParseError(configPath: string, err: Config.ConfigError): ConfigParseError {
	const msg = err.cause.toString();
	return new ConfigParseError({
		path: redactedForLog(configPath, redactPath),
		message:
			msg.includes("MissingKey") || msg.includes("InvalidValue") ? `Invalid config: ${msg}` : msg,
		fix: CONFIG_SCHEMA_FIX,
	});
}

/** Build provider: env orElse file (env overrides). */
function makeConfigProvider(
	configPath: string,
): Effect.Effect<
	ConfigProvider.ConfigProvider,
	ConfigParseError | FileSystemError,
	FileSystem.FileSystem
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const exists = yield* fs.exists(configPath).pipe(mapFsError(configPath, "exists"));
		if (!exists) {
			yield* Effect.logWarning({ event: "config_file_missing", path: configPath });
			return yield* Effect.fail(
				new ConfigParseError({
					path: redactedForLog(configPath, redactPath),
					message: "Config file not found",
					fix: CONFIG_SOURCE_FIX,
				}),
			);
		}
		const content = yield* fs
			.readFileString(configPath)
			.pipe(mapFsError(configPath, "readFileString"));
		const parsed = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (e) =>
				new ConfigParseError({
					path: redactedForLog(configPath, redactPath),
					message: `Invalid JSON: ${unknownToMessage(e)}`,
					fix: CONFIG_SCHEMA_FIX,
				}),
		});
		const fileProvider = ConfigProvider.fromUnknown(
			typeof parsed === "object" && parsed !== null ? parsed : {},
		);
		return ConfigProvider.orElse(envProvider(), fileProvider);
	});
}

const loadUsers = Effect.fn("paperless-ingestion-bot/shell/config.loadUsers")(function* (
	path: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const exists = yield* fs.exists(path).pipe(mapFsError(path, "exists"));
	if (!exists) {
		yield* Effect.fail(
			new ConfigParseError({
				path: redactedForLog(path, redactPath),
				message: "Users file does not exist",
				fix: usersHint(path),
			}),
		);
	}
	const content = yield* fs.readFileString(path).pipe(mapFsError(path, "readFileString"));
	if (content.trim() === "") {
		yield* Effect.fail(
			new ConfigParseError({
				path: redactedForLog(path, redactPath),
				message: "Users file is empty",
				fix: usersHint(path),
			}),
		);
	}
	return yield* Schema.decodeUnknownEffect(UsersJsonSchema)(content).pipe(
		Effect.mapError(
			(e) =>
				new ConfigParseError({
					path: redactedForLog(path, redactPath),
					message: `Invalid users.json: ${unknownToMessage(e)}`,
					fix: usersHint(path),
				}),
		),
	);
});

function handleConfigParseError(
	path: string,
	e: unknown,
): Effect.Effect<never, ConfigParseError | FileSystemError, never> {
	if (e instanceof ConfigParseError || e instanceof FileSystemError) {
		return Effect.fail(e);
	}
	return Effect.fail(
		new ConfigParseError({
			path: redactedForLog(path, redactPath),
			message: `Invalid config: ${unknownToMessage(e)}`,
			fix: CONFIG_PARSE_FIX,
		}),
	);
}

function readAndParseConfig<A>(
	configPath: string,
	usersPath: string,
	config: Config.Config<A>,
): Effect.Effect<
	{ raw: A; registry: UserRegistry },
	ConfigParseError | FileSystemError,
	FileSystem.FileSystem
> {
	return Effect.gen(function* () {
		const provider = yield* makeConfigProvider(configPath);
		const raw = yield* config
			.parse(provider)
			.pipe(Effect.mapError((e) => configErrorToParseError(configPath, e)));
		const users = yield* loadUsers(usersPath);
		const registry = yield* Effect.try({
			try: () => createUserRegistry(parseUserRegistry(users)),
			catch: (e) =>
				new ConfigParseError({
					path: redactedForLog(usersPath, redactPath),
					message: `Invalid users in users.json: ${unknownToMessage(e)}`,
					fix: usersHint(usersPath),
				}),
		});
		return { raw, registry };
	}).pipe(Effect.catch((e: unknown) => handleConfigParseError(configPath, e)));
}

const buildSignalConfigLayer = (
	configPath: string,
	usersPath: string,
	emailAccountsPath: string,
): Layer.Layer<SignalConfig, FileSystemError | ConfigParseError, FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.fn("paperless-ingestion-bot/shell/config.buildSignalConfigLayer")(function* (
			cfgPath: string,
			users: string,
			emailAccts: string,
		) {
			const { raw, registry } = yield* readAndParseConfig(
				cfgPath,
				users,
				Config.schema(RawSignalConfigSchema),
			);
			const base = toBaseConfig(raw, registry, users, emailAccts);
			const config: SignalConfigService = {
				...base,
				host: raw.webhook_host,
				port: raw.webhook_port,
			};
			yield* Effect.log({
				event: "config_resolved",
				configPath: cfgPath,
				users: config.registry.users.length,
				consumeDir: config.consumeDir,
			});
			return Layer.succeed(SignalConfig)(config);
		})(configPath, usersPath, emailAccountsPath),
	);

const buildEmailConfigLayer = (
	configPath: string,
	usersPath: string,
	emailAccountsPath: string,
): Layer.Layer<EmailConfig, FileSystemError | ConfigParseError, FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.fn("paperless-ingestion-bot/shell/config.buildEmailConfigLayer")(function* (
			cfgPath: string,
			users: string,
			emailAccts: string,
		) {
			const { raw, registry } = yield* readAndParseConfig(
				cfgPath,
				users,
				Config.schema(RawEmailConfigSchema),
			);
			const base = toBaseConfig(raw, registry, users, emailAccts);
			const config: EmailConfigService = {
				...base,
				ollamaUrl: raw.ollama_url,
				ollamaVisionModel: raw.ollama_vision_model,
				ollamaTextModel: raw.ollama_text_model,
				pageSize: raw.page_size,
				credentialFailureThrottleHours: raw.credential_failure_throttle_hours,
			};
			yield* Effect.log({
				event: "config_resolved",
				configPath: cfgPath,
				users: config.registry.users.length,
				consumeDir: config.consumeDir,
			});
			return Layer.succeed(EmailConfig)(config);
		})(configPath, usersPath, emailAccountsPath),
	);
