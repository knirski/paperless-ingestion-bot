/**
 * CredentialsStore live implementation — keytar (system keychain) with file fallback.
 *
 * Resolution: PAPERLESS_INGESTION_CREDENTIALS=file → use file store.
 * Otherwise try keytar. If keytar fails and PAPERLESS_INGESTION_CREDENTIALS_FILE is set, fall back to file.
 */

import {
	Cause,
	Effect,
	Exit,
	FileSystem,
	Layer,
	Option,
	Path,
	Redacted,
	Schema,
	ServiceMap,
} from "effect";
import { FileSystemError } from "../domain/errors.js";
import { redactedForLog, redactPath, unknownToMessage } from "../domain/utils.js";
import type { CredentialsStoreService } from "../interfaces/credentials-store.js";
import { mapFsError } from "../shell/fs-utils.js";

export class CredentialsStore extends ServiceMap.Service<
	CredentialsStore,
	CredentialsStoreService
>()("paperless-ingestion-bot/live/credentials-store") {
	static readonly live = Layer.effect(CredentialsStore)(buildCredentialsStore());
}

type PasswordMap = Record<string, string>;

/** Minimal keytar interface (getPassword, setPassword, deletePassword). Matches keytar package API. */
interface KeytarModule {
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
}

const SERVICE_NAME = "paperless-ingestion-bot";
const FILE_STORE_DEFAULT = "/var/lib/paperless-ingestion-bot/.passwords.json";
/** Logical identifier for keychain store (FileSystemError.path — not a filesystem path). */
const KEYTAR_PATH = "keytar";
const SENSITIVE_FILE_MODE = 0o600;

const PasswordMapEntrySchema = Schema.Record(Schema.String, Schema.String);
const PasswordMapJsonSchema = Schema.fromJsonString(PasswordMapEntrySchema);

/** Parse JSON content to password map; returns {} on parse/decode failure. */
function parsePasswordsJson(content: string): Effect.Effect<PasswordMap, never, never> {
	return Schema.decodeUnknownEffect(PasswordMapJsonSchema)(content).pipe(
		Effect.orElseSucceed(() => ({})),
	);
}

/** Keytar-based store. Passwords in system keychain. */
function createKeytarStore(keytar: KeytarModule): CredentialsStoreService {
	return CredentialsStore.of({
		getPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.getPassword")(function* (
			account: string,
		) {
			return yield* Effect.tryPromise({
				try: () => keytar.getPassword(SERVICE_NAME, account),
				catch: (e) =>
					new FileSystemError({
						path: redactedForLog(KEYTAR_PATH, redactPath),
						operation: "getPassword",
						message: unknownToMessage(e),
						fix: "Set PAPERLESS_INGESTION_CREDENTIALS=file for file-based fallback (e.g. headless Linux).",
					}),
			}).pipe(Effect.map((raw) => Option.fromNullOr(raw).pipe(Option.map(Redacted.make))));
		}),
		setPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.setPassword")(function* (
			account: string,
			password: string,
		) {
			return yield* Effect.tryPromise({
				try: () => keytar.setPassword(SERVICE_NAME, account, password),
				catch: (e) =>
					new FileSystemError({
						path: redactedForLog(KEYTAR_PATH, redactPath),
						operation: "setPassword",
						message: unknownToMessage(e),
						fix: "Set PAPERLESS_INGESTION_CREDENTIALS=file for file-based fallback (e.g. headless Linux).",
					}),
			});
		}),
		deletePassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.deletePassword")(
			function* (account: string) {
				return yield* Effect.tryPromise({
					try: () => keytar.deletePassword(SERVICE_NAME, account),
					catch: (e) =>
						new FileSystemError({
							path: redactedForLog(KEYTAR_PATH, redactPath),
							operation: "deletePassword",
							message: unknownToMessage(e),
							fix: "Set PAPERLESS_INGESTION_CREDENTIALS=file for file-based fallback (e.g. headless Linux).",
						}),
				});
			},
		),
	});
}

/** File-based store. Fallback when keytar unavailable (e.g. headless Linux). Less secure. */
function createFileStore(
	filePath: string,
): Effect.Effect<CredentialsStoreService, FileSystemError, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pathApi = yield* Path.Path;
		return CredentialsStore.of({
			getPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.getPassword")(
				function* (account: string) {
					return yield* Effect.gen(function* () {
						const exists = yield* fs.exists(filePath).pipe(mapFsError(filePath, "exists"));
						if (!exists) return Option.none();
						const content = yield* fs
							.readFileString(filePath)
							.pipe(mapFsError(filePath, "readFileString"));
						const data = yield* parsePasswordsJson(content);
						const raw = data[account];
						return Option.fromUndefinedOr(raw).pipe(Option.map(Redacted.make));
					});
				},
			),
			setPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.setPassword")(
				function* (account: string, password: string) {
					return yield* Effect.gen(function* () {
						const dir = pathApi.dirname(filePath);
						yield* fs
							.makeDirectory(dir, { recursive: true })
							.pipe(mapFsError(dir, "makeDirectory"));
						const exists = yield* fs.exists(filePath).pipe(mapFsError(filePath, "exists"));
						let data: PasswordMap = {};
						if (exists) {
							const content = yield* fs
								.readFileString(filePath)
								.pipe(mapFsError(filePath, "readFileString"));
							data = yield* parsePasswordsJson(content);
						}
						data[account] = password;
						yield* fs
							.writeFileString(filePath, JSON.stringify(data, null, 2))
							.pipe(mapFsError(filePath, "writeFileString"));
						yield* fs.chmod(filePath, SENSITIVE_FILE_MODE).pipe(Effect.catch(() => Effect.void));
					});
				},
			),
			deletePassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.deletePassword")(
				function* (account: string) {
					return yield* Effect.gen(function* () {
						const exists = yield* fs.exists(filePath).pipe(mapFsError(filePath, "exists"));
						if (!exists) return false;
						const content = yield* fs
							.readFileString(filePath)
							.pipe(mapFsError(filePath, "readFileString"));
						const data = yield* parsePasswordsJson(content);
						if (!(account in data)) return false;
						delete data[account];
						yield* fs
							.writeFileString(filePath, JSON.stringify(data, null, 2))
							.pipe(mapFsError(filePath, "writeFileString"));
						return true;
					});
				},
			),
		});
	});
}

/** Build CredentialsStore. Tries keytar first; falls back to file if env set. */
function buildCredentialsStore(): Effect.Effect<
	CredentialsStoreService,
	FileSystemError,
	FileSystem.FileSystem | Path.Path
> {
	return Effect.gen(function* () {
		const useFile = process.env.PAPERLESS_INGESTION_CREDENTIALS === "file";
		const filePath = process.env.PAPERLESS_INGESTION_CREDENTIALS_FILE ?? FILE_STORE_DEFAULT;

		if (useFile) {
			yield* Effect.log({
				event: "credentials_store",
				backend: "file",
				path: filePath,
				message: "Using file-based password store (PAPERLESS_INGESTION_CREDENTIALS=file)",
			});
			return yield* createFileStore(filePath);
		}

		const keytarExit = yield* Effect.exit(
			Effect.tryPromise({
				try: () => import("keytar"),
				catch: (e) => e,
			}),
		);

		const keytarResult = Exit.match(keytarExit, {
			onSuccess: (v) => ({ module: v, cause: undefined as Cause.Cause<unknown> | undefined }),
			onFailure: (e) => ({ module: undefined, cause: e }),
		});

		if (
			keytarResult.module &&
			typeof keytarResult.module.getPassword === "function" &&
			typeof keytarResult.module.setPassword === "function" &&
			typeof keytarResult.module.deletePassword === "function"
		) {
			yield* Effect.log({
				event: "credentials_store",
				backend: "keytar",
				message: "Using system keychain for app passwords",
			});
			return createKeytarStore(keytarResult.module);
		}

		if (process.env.PAPERLESS_INGESTION_CREDENTIALS_FILE !== undefined) {
			yield* Effect.logWarning({
				event: "credentials_store",
				backend: "file",
				path: filePath,
				message: "keytar unavailable, falling back to file store",
			});
			return yield* createFileStore(filePath);
		}

		const cause =
			keytarResult.cause ?? Cause.die(new Error("keytar module missing required methods"));
		return yield* Effect.die(
			new Error(
				`keytar unavailable (import or init failed). Fix: Set PAPERLESS_INGESTION_CREDENTIALS=file and optionally PAPERLESS_INGESTION_CREDENTIALS_FILE for file-based fallback (e.g. headless Linux).`,
				{ cause: Cause.squash(cause) },
			),
		);
	});
}

/** In-memory CredentialsStore for tests. */
export function createCredentialsStoreInMemory(passwords: PasswordMap): CredentialsStoreService {
	const map = new Map<string, string>(Object.entries(passwords));
	return CredentialsStore.of({
		getPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.getPassword")(function* (
			account: string,
		) {
			const raw = map.get(account);
			return yield* Effect.succeed(Option.fromUndefinedOr(raw).pipe(Option.map(Redacted.make)));
		}),
		setPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.setPassword")(function* (
			account: string,
			password: string,
		) {
			return yield* Effect.sync(() => {
				map.set(account, password);
			});
		}),
		deletePassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.deletePassword")(
			function* (account: string) {
				return yield* Effect.succeed(map.delete(account));
			},
		),
	});
}
