/**
 * CredentialsStore — abstract password storage (system keychain).
 *
 * Metadata (email, enabled, removed, excludeLabels) in JSON,
 * passwords in system keychain via @napi-rs/keyring.
 */

import type { Option, Redacted } from "effect";
import type { AccountEmail, AppEffect } from "../domain/types.js";

export interface CredentialsStoreService {
	readonly getPassword: (account: AccountEmail) => AppEffect<Option.Option<Redacted.Redacted>>;
	readonly setPassword: (account: AccountEmail, password: string) => AppEffect<void>;
	readonly deletePassword: (account: AccountEmail) => AppEffect<boolean>;
}
