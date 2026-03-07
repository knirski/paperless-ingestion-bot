/**
 * Pure account operations — format status, upsert.
 * Types and state machine live in domain/account.ts.
 */

import type { Redacted } from "effect";
import * as Arr from "effect/Array";
import type { Account } from "../domain/account.js";
import { resolveImapConfig } from "../domain/imap-provider.js";
import type { AccountEmail, EmailLabel, UserSlug } from "../domain/types.js";

const EMPTY_MSG =
	`📭 No email accounts yet.\n\n` +
	`Add your Gmail to start scanning: gmail add user@example.com xxxx xxxx xxxx xxxx\n` +
	`(App password: Google Account > Security > 2-Step Verification > App passwords)`;

type AccountTag = Account["_tag"];
const STATUS_LINES: Record<AccountTag, (acc: Account) => readonly [string, string]> = {
	active: (acc) => [`✅ ${acc.email}: Active`, `  Scanning (label-based). All good!`],
	paused: (acc) => [`⏸️ ${acc.email}: Paused`, `  To resume: gmail resume ${acc.email}`],
	removed: (acc) => [
		`🗑️ ${acc.email}: Removed`,
		`  To re-add: gmail add ${acc.email} <app_password>`,
	],
};

/** Add or update account. New accounts default to Gmail. */
export function upsertAccount(
	accounts: readonly Account[],
	email: AccountEmail,
	appPassword: Redacted.Redacted,
	addedBy: UserSlug,
	markProcessedLabel = "paperless" as EmailLabel,
): Account[] {
	const found = Arr.findFirstWithIndex(accounts, (a) => a.email === email);
	if (found) {
		const [acc, idx] = found;
		return accounts.with(idx, {
			...acc,
			appPassword,
			addedBy,
			_tag: "active" as const,
			excludeLabels: acc.excludeLabels,
			imapConfig: acc.imapConfig,
		});
	}
	const imapConfig = resolveImapConfig("gmail", markProcessedLabel);
	return [
		...accounts,
		{
			email,
			appPassword,
			addedBy,
			_tag: "active" as const,
			excludeLabels: [] as EmailLabel[],
			imapConfig,
		},
	];
}

/** Format account status for display. */
export function formatStatusMessage(accounts: readonly Account[]): string {
	if (accounts.length === 0) return EMPTY_MSG;

	const lines = Arr.flatMap(accounts, (acc) => [...STATUS_LINES[acc._tag](acc), ""]);
	return ["📧 Email Crawl Status", "", ...lines].join("\n");
}
