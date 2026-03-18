/**
 * Runtime I/O — JSON writes, credentials load/save.
 * Shell-only; used by pipelines.
 *
 * **User-generated data:** loadAllAccounts / saveAllAccounts operate on email-accounts.json
 * (path from config.emailAccountsPath). Created via `gmail add`; not configuration.
 * Metadata in JSON, passwords in system keychain.
 */

import { Effect, FileSystem, Option, Path, Redacted, Schema } from "effect";
import * as Arr from "effect/Array";
import {
	type Account,
	AccountMetadataSchema,
	detailsToImapConfig,
	type EmailAccountEntry,
	imapConfigToDetails,
	isImapDetails,
} from "../domain/account.js";
import { ConfigParseError } from "../domain/errors.js";
import { AccountEmailSchema, type EmailLabel } from "../domain/types.js";
import { redactedForLog, redactPath, unknownToMessage } from "../domain/utils.js";
import { CredentialsStore } from "../live/credentials-store.js";
import { mapFsError } from "./fs-utils.js";

/** Atomic write: temp file + rename (Python parity). */
export const atomicWriteJson = Effect.fn("atomicWriteJson")(function* (path: string, data: object) {
	const fs = yield* FileSystem.FileSystem;
	const pathApi = yield* Path.Path;
	const dir = pathApi.dirname(path);
	const base = pathApi.basename(path);
	const tmpPath = pathApi.join(dir, `${base}.tmp`);
	yield* fs
		.writeFileString(tmpPath, JSON.stringify(data, null, 2))
		.pipe(mapFsError(tmpPath, "writeFileString"));
	yield* fs.rename(tmpPath, path).pipe(mapFsError(path, "rename"));
});

const DEFAULT_EMAIL_ACCOUNTS_FIX =
	"Ensure file contains valid JSON array, e.g. [] for no accounts. Add accounts via Signal: gmail add user@example.com <app_password>.";

/** Serializable account entry for JSON (snake_case). */
type AccountSerializable = EmailAccountEntry;

/** Convert Account to JSON-serializable object. Pure; exported for testing. */
export function accountToSerializable(a: Account): AccountSerializable {
	return {
		email: a.email,
		enabled: a._tag === "active",
		removed: a._tag === "removed",
		exclude_labels: a.excludeLabels,
		added_by: a.addedBy,
		details: imapConfigToDetails(a.imapConfig),
	};
}

/** Build Account from metadata + password. Exported for testing. */
export const accountFromMetadata = Effect.fn("accountFromMetadata")(function* (
	obj: EmailAccountEntry,
	credentialsPath: string,
	markProcessedLabel: EmailLabel,
	appPassword: Redacted.Redacted,
) {
	if (!isImapDetails(obj.details)) {
		return yield* Effect.fail(
			new ConfigParseError({
				path: redactedForLog(credentialsPath, redactPath),
				message: "Unsupported connection type",
				fix: "Only gmail and generic_imap are supported.",
			}),
		);
	}
	const email = yield* Schema.decodeUnknownEffect(AccountEmailSchema)(obj.email).pipe(
		Effect.mapError(
			(e) =>
				new ConfigParseError({
					path: redactedForLog(credentialsPath, redactPath),
					message: `Invalid email in credentials: ${unknownToMessage(e)}`,
					fix: `Each account must have valid 'email' field. ${DEFAULT_EMAIL_ACCOUNTS_FIX}`,
				}),
		),
	);
	const tag = obj.removed
		? ("removed" as const)
		: obj.enabled
			? ("active" as const)
			: ("paused" as const);
	const imapConfig = detailsToImapConfig(obj.details, markProcessedLabel);
	return {
		email,
		appPassword,
		excludeLabels: obj.exclude_labels,
		imapConfig,
		addedBy: obj.added_by,
		_tag: tag,
	};
});

const fix = DEFAULT_EMAIL_ACCOUNTS_FIX;

export const loadAllAccounts = Effect.fn("loadAllAccounts")(function* (
	credentialsPath: string,
	markProcessedLabel = "paperless" as EmailLabel,
) {
	return yield* CredentialsStore.use((store) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const exists = yield* fs.exists(credentialsPath).pipe(mapFsError(credentialsPath, "exists"));
			if (!exists) return [];
			const content = yield* fs
				.readFileString(credentialsPath)
				.pipe(mapFsError(credentialsPath, "readFileString"));
			const trimmed = content.trim();
			if (trimmed === "") return [];
			const CredentialsArraySchema = Schema.Array(AccountMetadataSchema);
			const raw = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CredentialsArraySchema))(
				content,
			).pipe(
				Effect.mapError(
					(e) =>
						new ConfigParseError({
							path: redactedForLog(credentialsPath, redactPath),
							message: `Invalid JSON or credentials schema: ${unknownToMessage(e)}`,
							fix,
						}),
				),
			);

			const processEntry = (obj: EmailAccountEntry) =>
				Effect.gen(function* () {
					const email = yield* Schema.decodeUnknownEffect(AccountEmailSchema)(obj.email).pipe(
						Effect.mapError(
							(e) =>
								new ConfigParseError({
									path: redactedForLog(credentialsPath, redactPath),
									message: `Invalid email in credentials: ${unknownToMessage(e)}`,
									fix: `Each account must have valid 'email' field. ${DEFAULT_EMAIL_ACCOUNTS_FIX}`,
								}),
						),
					);
					const passwordOpt = yield* store.getPassword(email);
					return yield* Option.match(passwordOpt, {
						onNone: () => Effect.succeed(null),
						onSome: (appPassword) =>
							accountFromMetadata(obj, credentialsPath, markProcessedLabel, appPassword),
					});
				});

			const results = yield* Effect.forEach(raw, processEntry);
			return Arr.filter(results, (r): r is Account => r !== null);
		}),
	);
});

const SENSITIVE_FILE_MODE = 0o600; // rw------- owner only

export const saveAllAccounts = Effect.fn("saveAllAccounts")(function* (
	credentialsPath: string,
	accounts: Account[],
) {
	return yield* CredentialsStore.use((store) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const pathApi = yield* Path.Path;
			const dir = pathApi.dirname(credentialsPath);
			yield* fs.makeDirectory(dir, { recursive: true }).pipe(mapFsError(dir, "makeDirectory"));

			const data = accounts.map(accountToSerializable);
			yield* atomicWriteJson(credentialsPath, data);

			yield* Effect.forEach(
				accounts,
				(a) =>
					a._tag === "removed"
						? store.deletePassword(a.email)
						: store.setPassword(a.email, Redacted.value(a.appPassword)),
				{ discard: true },
			);

			yield* fs.chmod(credentialsPath, SENSITIVE_FILE_MODE).pipe(Effect.catch(() => Effect.void));
		}),
	);
});
