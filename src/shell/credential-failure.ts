/**
 * Credential failure notification — throttle, Signal, logging.
 * Used when IMAP connection fails (e.g. bad app password).
 */

import { Duration, Effect, Option } from "effect";
import * as Arr from "effect/Array";
import { RateLimiter } from "effect/unstable/persistence";
import { formatCredentialFailureMessage, isAuthFailure } from "../core/index.js";
import type { Account } from "../domain/account.js";
import { formatErrorForStructuredLog, ImapConnectionError } from "../domain/errors.js";
import { SignalClient } from "../live/signal-client.js";
import { EmailConfig } from "./config.js";

const handleProcessAccountError = Effect.fn("onProcessAccountError")(function* (
	acc: Account,
	e: unknown,
) {
	yield* Effect.logError({
		event: "email_pipeline_account",
		status: "failed",
		email: acc.email,
		error: formatErrorForStructuredLog(e),
	});
	if (e instanceof ImapConnectionError) {
		yield* notifyCredentialFailure(acc, e.message);
	}
});

/** On processAccount failure: log error, and if ImapConnectionError notify via Signal (throttled). */
export function onProcessAccountError(acc: Account) {
	return (e: unknown) => handleProcessAccountError(acc, e).pipe(Effect.catch(() => Effect.void));
}

/** Notify account owner of credential failure via Signal (throttled). */
const notifyCredentialFailure = Effect.fn("notifyCredentialFailure")(function* (
	acc: Account,
	errorMessage: string,
) {
	const config = yield* EmailConfig;
	if (!isAuthFailure(errorMessage)) return;
	yield* Option.match(
		Arr.findFirst(config.registry.users, (u) => u.slug === acc.addedBy),
		{
			onNone: () => Effect.void,
			onSome: (found) =>
				Effect.gen(function* () {
					const limiter = yield* RateLimiter.RateLimiter;
					const hours = config.credentialFailureThrottleHours;
					const rateLimitResult = yield* limiter
						.consume({
							key: acc.email,
							limit: 1,
							window: Duration.hours(hours),
							onExceeded: "fail",
						})
						.pipe(
							Effect.catchIf(
								(e): e is RateLimiter.RateLimiterError => e instanceof RateLimiter.RateLimiterError,
								() => Effect.succeed(null),
							),
						);
					if (rateLimitResult === null) return;
					const signalClient = yield* SignalClient;
					const accountOpt = yield* signalClient.getAccount();
					yield* Option.match(accountOpt, {
						onNone: () => Effect.void,
						onSome: (signalAccount) =>
							Effect.gen(function* () {
								const message = formatCredentialFailureMessage(
									acc.email,
									acc.addedBy,
									found.displayName,
								);
								yield* signalClient.sendMessage(signalAccount, found.signalNumber, message).pipe(
									Effect.tapError((err) =>
										Effect.logError({
											event: "credential_failure_notify",
											status: "failed",
											email: acc.email,
											error: formatErrorForStructuredLog(err),
										}),
									),
									Effect.catch(() => Effect.void),
								);
								yield* Effect.log({
									event: "credential_failure_notify",
									status: "sent",
									email: acc.email,
									addedBy: acc.addedBy,
								});
							}),
					});
				}),
		},
	);
});
