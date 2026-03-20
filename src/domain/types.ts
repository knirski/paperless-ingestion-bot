/**
 * Domain types and logic for paperless-ingestion-bot.
 */

import { type Effect, Option, Schema } from "effect";
import * as Arr from "effect/Array";
import type { DomainError } from "./errors.js";
import type { SignalNumber } from "./signal-types.js";

/** Effect type for app functions. All failures are DomainError (native errors wrapped). */
export type AppEffect<T, R = never> = Effect.Effect<T, DomainError, R>;

/** Email pattern (aligned with core.validateEmail). */
const EMAIL_PATTERN = /^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/;

/**
 * Branded types: primitives (string, number) with a phantom "brand" that makes them
 * distinct at compile time. You can't pass a plain string where AccountEmail is expected —
 * you must obtain it via decode/validation. Runtime value is unchanged.
 */
export const AccountEmailSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(EMAIL_PATTERN, { expected: "Invalid email format" })),
	Schema.brand("AccountEmail"),
);
export type AccountEmail = Schema.Schema.Type<typeof AccountEmailSchema>;

export const UserSlugSchema = Schema.String.pipe(Schema.brand("UserSlug"));
export type UserSlug = Schema.Schema.Type<typeof UserSlugSchema>;

/** Gmail/IMAP label (e.g. "SPAM", "category:promotions", exclude_labels, mark-processed label, message labels). */
export const EmailLabelSchema = Schema.String.pipe(Schema.brand("EmailLabel"));
export type EmailLabel = Schema.Schema.Type<typeof EmailLabelSchema>;

/** IMAP message UID (unique identifier within mailbox). */
export const MessageUidSchema = Schema.Number.pipe(Schema.brand("MessageUid"));
export type MessageUid = Schema.Schema.Type<typeof MessageUidSchema>;

/** User registered for ingestion. */
export interface User {
	readonly slug: UserSlug;
	readonly signalNumber: SignalNumber;
	readonly displayName: string;
}

/** User registry — lookup by Signal number. */
export interface UserRegistry {
	readonly users: readonly User[];
	findBySignal(number: SignalNumber): User | undefined;
}

/** Create a user registry for lookup by Signal number. */
export function createUserRegistry(users: readonly User[]): UserRegistry {
	return {
		users,
		findBySignal(number: SignalNumber) {
			return Option.getOrUndefined(Arr.findFirst(users, (u) => u.signalNumber === number));
		},
	};
}
