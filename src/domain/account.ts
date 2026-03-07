/**
 * Email account state machine and persistence types.
 * Supports Gmail and generic IMAP via ImapProviderConfig.
 */

import { Match, type Redacted, Schema } from "effect";
import { type ImapProviderConfig, resolveImapConfig } from "./imap-provider.js";
import {
	type AccountEmail,
	type EmailLabel,
	EmailLabelSchema,
	type UserSlug,
	UserSlugSchema,
} from "./types.js";

/** Account state machine: active → paused/removed; paused → active/removed; removed is terminal. */
export const AccountStatus = {
	Active: "active",
	Paused: "paused",
	Removed: "removed",
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** Email account base — shared fields. */
interface AccountBase {
	readonly email: AccountEmail;
	readonly appPassword: Redacted.Redacted;
	readonly excludeLabels: readonly EmailLabel[];
	readonly imapConfig: ImapProviderConfig;
	/** User slug who added the account (required for per-user credential failure notifications). */
	readonly addedBy: UserSlug;
}

/** Active account: scanning enabled. */
export interface ActiveAccount extends AccountBase {
	readonly _tag: "active";
}

/** Paused account: scanning disabled, can resume. */
export interface PausedAccount extends AccountBase {
	readonly _tag: "paused";
}

/** Removed account: must re-add to use again. Terminal state. */
export interface RemovedAccount extends AccountBase {
	readonly _tag: "removed";
}

/** Email account — state machine with explicit status. */
export type Account = ActiveAccount | PausedAccount | RemovedAccount;

/** Predicate: narrow Account to ActiveAccount. Use with Arr.filter for active-only lists. */
export const isActiveAccount = (a: Account): a is ActiveAccount => a._tag === "active";

/** Transition: pause an active account. */
function pauseAccount(acc: ActiveAccount): PausedAccount {
	return { ...acc, _tag: "paused" as const };
}

/** Transition: resume a paused account. */
function resumeAccount(acc: PausedAccount): ActiveAccount {
	return { ...acc, _tag: "active" as const };
}

/** Transition: remove an active or paused account. */
function removeAccount(acc: ActiveAccount | PausedAccount): RemovedAccount {
	return { ...acc, _tag: "removed" as const };
}

/** Transition account to target status; no-op if already there or transition invalid. */
export function transitionAccount(acc: Account, status: AccountStatus): Account {
	return Match.value(status).pipe(
		Match.when("removed", () => (acc._tag === "removed" ? acc : removeAccount(acc))),
		Match.when("active", () => (acc._tag === "paused" ? resumeAccount(acc) : acc)),
		Match.when("paused", () => (acc._tag === "active" ? pauseAccount(acc) : acc)),
		Match.exhaustive,
	);
}

const AccountEntryBase = {
	email: Schema.String,
	enabled: Schema.Boolean,
	removed: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
	exclude_labels: Schema.Array(EmailLabelSchema).pipe(Schema.withDecodingDefault(() => [])),
	added_by: UserSlugSchema,
} as const;

/** Gmail connection details — no overrides. */
interface GmailDetails {
	readonly type: "gmail";
}

/** Generic IMAP connection details — required connection params. */
interface GenericImapDetails {
	readonly type: "generic_imap";
	readonly host: string;
	readonly port: number;
	readonly secure: boolean;
	readonly mailbox: string;
}

/** Connection details — discriminated union. Extend with MicrosoftGraphDetails etc. for non-IMAP. */
export type ConnectionDetails = GmailDetails | GenericImapDetails;

/** Type guard: narrow ConnectionDetails to IMAP types. Used when we add non-IMAP (e.g. Microsoft Graph). */
export const isImapDetails = (d: ConnectionDetails): d is GmailDetails | GenericImapDetails =>
	d.type === "gmail" || d.type === "generic_imap";

const GmailDetailsSchema = Schema.Struct({
	type: Schema.Literal("gmail"),
});

const GenericImapDetailsSchema = Schema.Struct({
	type: Schema.Literal("generic_imap"),
	host: Schema.String,
	port: Schema.Int,
	secure: Schema.Boolean,
	mailbox: Schema.String,
});

const ConnectionDetailsSchema = Schema.Union([GmailDetailsSchema, GenericImapDetailsSchema]);

/** Convert ConnectionDetails (IMAP only) to ImapProviderConfig. Pure. */
export function detailsToImapConfig(
	details: GmailDetails | GenericImapDetails,
	markProcessedLabel: EmailLabel,
): ImapProviderConfig {
	return Match.value(details).pipe(
		Match.when({ type: "gmail" }, () => resolveImapConfig("gmail", markProcessedLabel)),
		Match.when({ type: "generic_imap" }, (d) =>
			resolveImapConfig("generic", markProcessedLabel, {
				host: d.host,
				port: d.port,
				secure: d.secure,
				mailbox: d.mailbox,
			}),
		),
		Match.exhaustive,
	);
}

/** Convert ImapProviderConfig to ConnectionDetails for serialization. Pure. */
export function imapConfigToDetails(imapConfig: ImapProviderConfig): ConnectionDetails {
	return Match.value(imapConfig.provider).pipe(
		Match.when("gmail", () => ({ type: "gmail" }) as const),
		Match.when(
			"generic",
			() =>
				({
					type: "generic_imap",
					host: imapConfig.host,
					port: imapConfig.port,
					secure: imapConfig.secure,
					mailbox: imapConfig.mailbox,
				}) as const,
		),
		Match.exhaustive,
	);
}

/** Email account entry from JSON (snake_case). Unified structure with details discriminator. */
export interface EmailAccountEntry {
	readonly email: string;
	readonly enabled: boolean;
	readonly removed: boolean;
	readonly exclude_labels: readonly EmailLabel[];
	readonly added_by: UserSlug;
	readonly details: ConnectionDetails;
}

const EmailAccountEntrySchema = Schema.Struct({
	...AccountEntryBase,
	details: ConnectionDetailsSchema,
});

/** Schema for validating account metadata from JSON. */
export const AccountMetadataSchema = EmailAccountEntrySchema;
