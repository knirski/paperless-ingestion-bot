/**
 * Optional keyring availability test. Skips when KEYRING_TEST is not set.
 *
 * Verifies CredentialsStore.live (system keychain) builds and performs a
 * round-trip: setPassword → getPassword → deletePassword.
 *
 * Run with:
 *   KEYRING_TEST=1 npm run test:integration
 *
 * Skips when KEYRING_TEST is not set (like Gmail test). When set, runs the test;
 * fails if keyring is unavailable (e.g. headless Linux, CI without keychain).
 */

import { describe, expect, it } from "bun:test";
import { Effect, Exit, Layer, Option, pipe, Redacted } from "effect";
import type { AccountEmail } from "../../src/domain/types.js";
import { CredentialsStore } from "../../src/live/credentials-store.js";
import { PlatformServicesLayer } from "../../src/shell/layers.js";
import { SilentLoggerLayer } from "../test-utils.js";

const runKeyringTest = process.env.KEYRING_TEST === "1";

const TEST_ACCOUNT = "keyring-test@example.com" as AccountEmail;
const TEST_VALUE = "test-value";

const NOT_AVAILABLE_MSG =
	"keyring: not available (e.g. headless Linux, CI without keychain). Ensure system credential store is available.";

const keyringCheckEffect = Effect.gen(function* () {
	if (!runKeyringTest) return { available: false, skipped: true };
	const exit = yield* CredentialsStore.live.pipe(Layer.build, Effect.exit);
	return Exit.match(exit, {
		onSuccess: () => ({ available: true, skipped: false }),
		onFailure: () => ({ available: false, skipped: false }),
	});
}).pipe(Effect.scoped);

const keyringCheck = await Effect.runPromise(keyringCheckEffect);

const runKeyringRoundTrip = Effect.gen(function* () {
	const store = yield* CredentialsStore;
	yield* store.setPassword(TEST_ACCOUNT, TEST_VALUE);
	const gotOpt = yield* store.getPassword(TEST_ACCOUNT);
	const deleted = yield* store.deletePassword(TEST_ACCOUNT);
	const afterDeleteOpt = yield* store.getPassword(TEST_ACCOUNT);
	const got = Option.match(gotOpt, { onNone: () => null, onSome: Redacted.value });
	const afterDelete = Option.match(afterDeleteOpt, { onNone: () => null, onSome: Redacted.value });
	return { got, deleted, afterDelete };
}).pipe(
	Effect.tap(() => Effect.log("keyring: available and working")),
	Effect.provide(CredentialsStore.live),
	Effect.provide(SilentLoggerLayer),
	Effect.provide(PlatformServicesLayer),
);

describe("keyring integration", () => {
	it.skipIf(runKeyringTest)("keyring test skipped (set KEYRING_TEST=1 to run)", async () => {
		await Effect.runPromise(
			pipe(
				Effect.log(
					"keyring: skipped. Set KEYRING_TEST=1 to run system keychain availability test.",
				),
				Effect.provide(SilentLoggerLayer),
			),
		);
	});

	it.skipIf(!runKeyringTest || keyringCheck.available)(
		"keyring not available on this system",
		async () => {
			await Effect.runPromise(
				pipe(Effect.log(NOT_AVAILABLE_MSG), Effect.provide(SilentLoggerLayer)),
			);
			expect(keyringCheck.available, NOT_AVAILABLE_MSG).toBe(true);
		},
	);

	it.skipIf(!runKeyringTest || !keyringCheck.available)(
		"keyring is available and supports round-trip",
		async () => {
			const { got, deleted, afterDelete } = await Effect.runPromise(runKeyringRoundTrip);

			expect(got).toBe(TEST_VALUE);
			expect(deleted).toBe(true);
			expect(afterDelete).toBeNull();
		},
	);
});
