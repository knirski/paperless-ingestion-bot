/**
 * Config service — JSON config (Nix-generated), Schema-based validation.
 *
 * Resolution: --config or default path. Nix generates config via builtins.toJSON.
 */

import { Effect, FileSystem, Layer, type Schedule, Schema, ServiceMap } from "effect";
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
import { redactPath, redactedForLog, unknownToMessage } from "../domain/utils.js";
import { mapFsError } from "./fs-utils.js";

/** Log level for config. */
export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Base config shared by Signal and Email pipelines. */
interface BaseConfig {
	readonly consumeDir: string;
	readonly emailAccountsPath: string;
	readonly ingestUsersPath: string;
	readonly signalApiUrl: string;
	readonly registry: UserRegistry;
	readonly logLevel: LogLevel;
	/** Label/flag for processed messages (used when adding accounts). */
	readonly markProcessedLabel: EmailLabel;
}

/** Signal webhook config (service shape). */
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

/** Email ingestion config (service shape). */
export interface EmailConfigService extends BaseConfig {
	readonly ollamaUrl: string;
	readonly ollamaVisionModel: string;
	readonly ollamaTextModel: string;
	/** Messages per page when paginating search results (positive integer). */
	readonly pageSize: number;
	/** Override IMAP retry schedule (tests only). When unset, uses default exponential backoff. */
	readonly imapRetrySchedule?: Schedule.Schedule<unknown>;
}

export class EmailConfig extends ServiceMap.Service<EmailConfig, EmailConfigService>()(
	"paperless-ingestion-bot/shell/config/email",
) {
	static get layer() {
		return buildEmailConfigLayer;
	}
}

/** Default config path. Override with --config or PAPERLESS_INGESTION_CONFIG env. */
export const DEFAULT_CONFIG_PATH = "/etc/paperless-ingestion-bot/config.json";

/** Resolve config path: --config > PAPERLESS_INGESTION_CONFIG env > default. */
export function resolveConfigPath(cliPath: string | undefined): string {
	return cliPath ?? process.env.PAPERLESS_INGESTION_CONFIG ?? DEFAULT_CONFIG_PATH;
}

/** User entry (full object from ingest-users.json). */
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

/** Shared base fields (Signal and Email use the same config file). */
const sharedConfigFields = {
	consume_dir: Schema.String,
	email_accounts_path: Schema.String,
	signal_api_url: Schema.String,
	ingest_users_path: Schema.String,
	log_level: Schema.Literals(LOG_LEVELS).pipe(Schema.withDecodingDefault(() => "INFO")),
	mark_processed_label: EmailLabelSchema.pipe(
		Schema.withDecodingDefault(() => "paperless" as EmailLabel),
	),
} as const;

/** Port range 0–65535 (0 = OS chooses available port). */
const PortSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	Schema.check(Schema.isLessThanOrEqualTo(65535)),
);

/** Raw schema for Signal config (snake_case from Nix JSON). */
const RawSignalConfigSchema = Schema.Struct({
	...sharedConfigFields,
	webhook_host: Schema.String,
	webhook_port: PortSchema,
});

const SignalConfigJsonSchema = Schema.fromJsonString(RawSignalConfigSchema);

/** Raw schema for Email config (snake_case from Nix JSON). */
const RawEmailConfigSchema = Schema.Struct({
	...sharedConfigFields,
	ollama_url: Schema.String,
	ollama_vision_model: Schema.String,
	ollama_text_model: Schema.String,
	page_size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
		Schema.withDecodingDefault(() => 50),
	),
});

const EmailConfigJsonSchema = Schema.fromJsonString(RawEmailConfigSchema);

const readConfigFile = Effect.fn("paperless-ingestion-bot/shell/config.readConfigFile")(function* (
	path: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const exists = yield* fs.exists(path).pipe(mapFsError(path, "exists"));
	if (!exists) {
		yield* Effect.logWarning({ event: "config_file_missing", path });
		yield* Effect.fail(
			new ConfigParseError({
				path: redactedForLog(path, redactPath),
				message: "Config file not found",
				fix: "Pass --config /path or set PAPERLESS_INGESTION_CONFIG. Default: /etc/paperless-ingestion-bot/config.json",
			}),
		);
	}
	return yield* fs.readFileString(path).pipe(mapFsError(path, "readFileString"));
});

/** Hardcoded hint for system admin (ingest-users.json errors). */
export function ingestUsersHint(path: string): string {
	return `Create ${path} with: [{"slug":"krzysiek","signal_number":"+48...","consume_subdir":"krzysiek","display_name":"Krzysiek","tag_name":"Added by Krzysiek"},...]`;
}

const UsersArraySchema = Schema.Array(UserSchema);
const IngestUsersJsonSchema = Schema.fromJsonString(UsersArraySchema);

const loadIngestUsers = Effect.fn("paperless-ingestion-bot/shell/config.loadIngestUsers")(
	function* (path: string) {
		const fs = yield* FileSystem.FileSystem;
		const exists = yield* fs.exists(path).pipe(mapFsError(path, "exists"));
		if (!exists) {
			yield* Effect.fail(
				new ConfigParseError({
					path: redactedForLog(path, redactPath),
					message: "Ingest users file does not exist",
					fix: ingestUsersHint(path),
				}),
			);
		}
		const content = yield* fs.readFileString(path).pipe(mapFsError(path, "readFileString"));
		if (content.trim() === "") {
			yield* Effect.fail(
				new ConfigParseError({
					path: redactedForLog(path, redactPath),
					message: "Ingest users file is empty",
					fix: ingestUsersHint(path),
				}),
			);
		}
		return yield* decodeRawConfig(path, content, IngestUsersJsonSchema);
	},
);

const CONFIG_SCHEMA_FIX =
	"Ensure config has required fields: consume_dir, email_accounts_path, ingest_users_path, signal_api_url, etc. See README.";
const CONFIG_PARSE_FIX = "Check config file format and required fields. See README.";

function decodeRawConfig<A>(
	path: string,
	content: string,
	schema: Schema.Schema<A>,
): Effect.Effect<A, ConfigParseError, never> {
	return Schema.decodeUnknownEffect(schema)(content).pipe(
		Effect.mapError(
			(e) =>
				new ConfigParseError({
					path: redactedForLog(path, redactPath),
					message: `Invalid JSON or config schema: ${unknownToMessage(e)}`,
					fix: CONFIG_SCHEMA_FIX,
				}),
		),
	) as Effect.Effect<A, ConfigParseError, never>;
}

const buildRegistryFromPath = Effect.fn(
	"paperless-ingestion-bot/shell/config.buildRegistryFromPath",
)(function* (configPath: string, ingestUsersPath: string) {
	const users = yield* loadIngestUsers(ingestUsersPath);
	return yield* Effect.try({
		try: () => createUserRegistry(parseUserRegistry(users)),
		catch: (e) =>
			new ConfigParseError({
				path: redactedForLog(configPath, redactPath),
				message: `Invalid users in config: ${unknownToMessage(e)}`,
				fix: ingestUsersHint(ingestUsersPath),
			}),
	});
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

/** Read config file, decode with schema, create user registry. Shared by Signal and Email config layers. */
function readAndParseConfig<A extends { ingest_users_path: string }>(
	path: string,
	schema: Schema.Schema<A>,
): Effect.Effect<
	{ raw: A; registry: UserRegistry },
	ConfigParseError | FileSystemError,
	FileSystem.FileSystem
> {
	const parse = Effect.gen(function* () {
		const content = yield* readConfigFile(path);
		const raw = yield* decodeRawConfig(path, content, schema);
		const registry = yield* buildRegistryFromPath(path, raw.ingest_users_path);
		return { raw, registry };
	});
	return parse.pipe(Effect.catch((e: unknown) => handleConfigParseError(path, e)));
}

const buildSignalConfigLayer = (
	configPath?: string,
): Layer.Layer<SignalConfig, FileSystemError | ConfigParseError, FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.fn("paperless-ingestion-bot/shell/config.buildSignalConfigLayer")(function* (
			cfgPath?: string,
		) {
			const path = cfgPath ?? DEFAULT_CONFIG_PATH;
			const { raw, registry } = yield* readAndParseConfig(path, SignalConfigJsonSchema);
			const config: SignalConfigService = {
				consumeDir: raw.consume_dir,
				emailAccountsPath: raw.email_accounts_path,
				ingestUsersPath: raw.ingest_users_path,
				signalApiUrl: raw.signal_api_url,
				registry,
				logLevel: raw.log_level,
				markProcessedLabel: raw.mark_processed_label,
				host: raw.webhook_host,
				port: raw.webhook_port,
			};
			yield* Effect.log({
				event: "config_resolved",
				configPath: path,
				users: config.registry.users.length,
				consumeDir: config.consumeDir,
			});
			return Layer.succeed(SignalConfig)(config);
		})(configPath),
	);

const buildEmailConfigLayer = (
	configPath?: string,
): Layer.Layer<EmailConfig, FileSystemError | ConfigParseError, FileSystem.FileSystem> =>
	Layer.unwrap(
		Effect.fn("paperless-ingestion-bot/shell/config.buildEmailConfigLayer")(function* (
			cfgPath?: string,
		) {
			const path = cfgPath ?? DEFAULT_CONFIG_PATH;
			const { raw, registry } = yield* readAndParseConfig(path, EmailConfigJsonSchema);
			const config: EmailConfigService = {
				consumeDir: raw.consume_dir,
				emailAccountsPath: raw.email_accounts_path,
				ingestUsersPath: raw.ingest_users_path,
				signalApiUrl: raw.signal_api_url,
				registry,
				logLevel: raw.log_level,
				markProcessedLabel: raw.mark_processed_label,
				ollamaUrl: raw.ollama_url,
				ollamaVisionModel: raw.ollama_vision_model,
				ollamaTextModel: raw.ollama_text_model,
				pageSize: raw.page_size,
			};
			yield* Effect.log({
				event: "config_resolved",
				configPath: path,
				users: config.registry.users.length,
				consumeDir: config.consumeDir,
			});
			return Layer.succeed(EmailConfig)(config);
		})(configPath),
	);
