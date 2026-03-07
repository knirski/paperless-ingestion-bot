import { Layer } from "effect";
import {
	CredentialsStore,
	createCredentialsStoreInMemory,
} from "../../src/live/credentials-store.js";

/** CredentialsStore for tests (in-memory, no keyring). */
export function credentialsStoreTest(passwords: Record<string, string>) {
	return Layer.succeed(CredentialsStore)(createCredentialsStoreInMemory(passwords));
}
