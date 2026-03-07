/**
 * CredentialsStore live implementation — system keychain only (no file fallback).
 *
 * Uses @napi-rs/keyring for OS keychain access. Fails clearly when keyring unavailable.
 * See ADR-0001.
 */

import type { AsyncEntry } from "@napi-rs/keyring";
import { Cause, Effect, Exit, Layer, Option, Redacted, ServiceMap } from "effect";
import { KeyringError } from "../domain/errors.js";
import { unknownToMessage } from "../domain/utils.js";
import type { CredentialsStoreService } from "../interfaces/credentials-store.js";

export class CredentialsStore extends ServiceMap.Service<
	CredentialsStore,
	CredentialsStoreService
>()("paperless-ingestion-bot/live/credentials-store") {
	static readonly live = Layer.effect(CredentialsStore)(buildCredentialsStore());
}

type PasswordMap = Record<string, string>;

const SERVICE_NAME = "paperless-ingestion-bot";

/** Platform-specific guidance for keyring/credential store setup. */
function keyringFix(): string {
	switch (process.platform) {
		case "linux":
			return "Ensure a Secret Service implementation is available (e.g. gnome-keyring, kwallet, KeePassXC). On headless Linux, run a secret service or use a session with keychain support. See https://specifications.freedesktop.org/secret-service/ for options.";
		case "darwin":
			return "Ensure Keychain Access is available and unlocked. On headless macOS, run in a session with keychain access or use a keychain that does not require user interaction.";
		case "win32":
			return "Ensure Windows Credential Manager is available. Check that the Credential Manager service is running.";
		default:
			return "Ensure the system credential store is available. See https://github.com/Brooooooklyn/keyring-node for platform requirements.";
	}
}

/** Keyring-based store. Passwords in system keychain via AsyncEntry. */
function createKeyringStore(
	AsyncEntry: new (service: string, account: string) => AsyncEntry,
): CredentialsStoreService {
	return CredentialsStore.of({
		getPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.getPassword")(function* (
			account: string,
		) {
			const raw = yield* Effect.tryPromise({
				try: () => new AsyncEntry(SERVICE_NAME, account).getPassword(),
				catch: (e) =>
					new KeyringError({
						message: unknownToMessage(e),
						operation: "getPassword",
						fix: keyringFix(),
					}),
			});
			return Option.fromNullishOr(raw).pipe(Option.map((s) => Redacted.make(s)));
		}),
		setPassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.setPassword")(function* (
			account: string,
			password: string,
		) {
			return yield* Effect.tryPromise({
				try: () => new AsyncEntry(SERVICE_NAME, account).setPassword(password),
				catch: (e) =>
					new KeyringError({
						message: unknownToMessage(e),
						operation: "setPassword",
						fix: keyringFix(),
					}),
			});
		}),
		deletePassword: Effect.fn("paperless-ingestion-bot/live/credentials-store.deletePassword")(
			function* (account: string) {
				const result = yield* Effect.tryPromise({
					try: () => new AsyncEntry(SERVICE_NAME, account).deletePassword(),
					catch: (e) =>
						new KeyringError({
							message: unknownToMessage(e),
							operation: "deletePassword",
							fix: keyringFix(),
						}),
				});
				return Boolean(result);
			},
		),
	});
}

/** Build CredentialsStore. Uses system keychain only; fails when unavailable. */
function buildCredentialsStore(): Effect.Effect<CredentialsStoreService, KeyringError, never> {
	return Effect.gen(function* () {
		const keyringExit = yield* Effect.exit(
			Effect.tryPromise({
				try: () => import("@napi-rs/keyring"),
				catch: (e) => e,
			}),
		);

		const keyringResult = Exit.match(keyringExit, {
			onSuccess: (m) => ({
				AsyncEntry: m.AsyncEntry,
				cause: undefined as Cause.Cause<unknown> | undefined,
			}),
			onFailure: (e) => ({ AsyncEntry: undefined, cause: e }),
		});

		if (keyringResult.AsyncEntry && typeof keyringResult.AsyncEntry === "function") {
			yield* Effect.log({
				event: "credentials_store",
				backend: "keyring",
				message: "Using system keychain for app passwords",
			});
			return createKeyringStore(keyringResult.AsyncEntry);
		}

		const cause = keyringResult.cause ?? Cause.die(new Error("keyring module missing AsyncEntry"));
		const message = unknownToMessage(Cause.squash(cause));
		return yield* Effect.fail(
			new KeyringError({
				message: `System keychain unavailable: ${message}`,
				operation: "init",
				fix: keyringFix(),
			}),
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
