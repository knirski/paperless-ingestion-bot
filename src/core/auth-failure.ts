/**
 * Auth failure detection and credential expiry notification helpers.
 * Pure functions for isAuthFailure, formatCredentialFailureMessage.
 * Throttle logic uses Temporal.Instant.
 */

import { Temporal } from "@js-temporal/polyfill";
import type { UserSlug } from "../domain/types.js";

/** Regex to detect auth/credential/login failures in error messages. */
const AUTH_FAILURE_REGEX = /auth|credential|login\s*failed|access\s*denied|unauthorized/i;

/** Returns true if the error message indicates an auth/credential failure. */
export function isAuthFailure(errorMessage: string): boolean {
	return AUTH_FAILURE_REGEX.test(errorMessage);
}

/** Format credential failure message for Signal notification. */
export function formatCredentialFailureMessage(
	email: string,
	addedBy: UserSlug,
	displayName?: string,
): string {
	const who = displayName ?? addedBy;
	return (
		`⚠️ Gmail login failed for ${email} (added by ${who}).\n\n` +
		`Credentials may have expired or been revoked. To fix: gmail add ${email} <app_password>`
	);
}

/** Default throttle interval: 24 hours. */
const THROTTLE_INTERVAL = Temporal.Duration.from({ hours: 24 });

/** Check if we should notify (not throttled). */
export function shouldNotify(
	lastNotifiedAt: Temporal.Instant | undefined,
	now: Temporal.Instant,
	interval: Temporal.Duration = THROTTLE_INTERVAL,
): boolean {
	if (!lastNotifiedAt) return true;
	const elapsed = now.since(lastNotifiedAt);
	return Temporal.Duration.compare(elapsed, interval) >= 0;
}
