/**
 * Integration test for keytar availability.
 *
 * Verifies that keytar (system keychain) can be imported and performs a
 * round-trip: setPassword → getPassword → deletePassword.
 *
 * Skips when keytar is unavailable (common in CI, headless Linux, or when
 * native modules fail to build).
 *
 * Run with: npm run test:integration
 */

import { Effect, pipe } from "effect";
import { describe, expect, it } from "vitest";
import { LoggerLayer } from "../../src/shell/layers.js";

const TEST_ACCOUNT = "test-550e8400-e29b-41d4-a716-446655440000";
const SERVICE_NAME = "paperless-ingestion-bot-keytar-test";
const TEST_VALUE = "test-value";

const NOT_AVAILABLE_MSG =
	"keytar: not available (e.g. headless Linux, CI without keychain). Use PAPERLESS_INGESTION_CREDENTIALS=file for file-based fallback.";

const keytarCheck = await (async () => {
	try {
		const keytar = await import("keytar");
		const hasApi =
			typeof keytar.getPassword === "function" &&
			typeof keytar.setPassword === "function" &&
			typeof keytar.deletePassword === "function";
		if (!hasApi) return { available: false, module: null };
		// Probe: keychain must be reachable (e.g. dbus, machine-id). Fails in Nix sandbox, headless CI.
		try {
			await keytar.getPassword(SERVICE_NAME, "probe-nonexistent");
			return { available: true, module: keytar };
		} catch {
			return { available: false, module: null };
		}
	} catch {
		return { available: false, module: null };
	}
})();

const runKeytarRoundTrip = pipe(
	Effect.tryPromise({
		try: async () => {
			const keytar = keytarCheck.module;
			if (!keytar) throw new Error("keytar not available");
			await keytar.setPassword(SERVICE_NAME, TEST_ACCOUNT, TEST_VALUE);
			const got = await keytar.getPassword(SERVICE_NAME, TEST_ACCOUNT);
			const deleted = await keytar.deletePassword(SERVICE_NAME, TEST_ACCOUNT);
			const afterDelete = await keytar.getPassword(SERVICE_NAME, TEST_ACCOUNT);
			return { got, deleted, afterDelete };
		},
		catch: (e) => e,
	}),
	Effect.tap(() => Effect.log("keytar: available and working")),
	Effect.provide(LoggerLayer),
);

describe("keytar integration", () => {
	it.skipIf(keytarCheck.available)("keytar not available on this system", async () => {
		await Effect.runPromise(pipe(Effect.log(NOT_AVAILABLE_MSG), Effect.provide(LoggerLayer)));
	});

	it.skipIf(!keytarCheck.available)("keytar is available and supports round-trip", async () => {
		const { got, deleted, afterDelete } = await Effect.runPromise(runKeytarRoundTrip);

		expect(got).toBe(TEST_VALUE);
		expect(deleted).toBe(true);
		expect(afterDelete).toBeNull();
	});
});
