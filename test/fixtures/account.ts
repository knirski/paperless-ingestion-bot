import { Redacted, Schema } from "effect";
import type { Account } from "../../src/domain/account.js";
import { resolveImapConfig } from "../../src/domain/imap-provider.js";
import { AccountEmailSchema, type EmailLabel, type UserSlug } from "../../src/domain/types.js";

/** Create a minimal test Account (active, Gmail) with valid AccountEmail. */
export function createTestAccount(
	email = "test@example.com",
	overrides?: Partial<Omit<Account, "email">>,
): Account {
	return {
		_tag: "active",
		email: Schema.decodeSync(AccountEmailSchema)(email),
		appPassword: Redacted.make("secret"),
		excludeLabels: [] as EmailLabel[],
		imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
		addedBy: "user1" as UserSlug,
		...overrides,
	};
}
