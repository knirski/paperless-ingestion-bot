/**
 * Auth failure detection and credential expiry notification helpers.
 * Pure functions for isAuthFailure, formatCredentialFailureMessage.
 */

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
