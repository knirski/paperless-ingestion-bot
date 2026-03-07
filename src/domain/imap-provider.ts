/**
 * IMAP provider configuration — separates Gmail idiosyncrasies from generic IMAP.
 *
 * Provider "gmail" uses X-GM-RAW search, labels, [Gmail]/All Mail.
 * Provider "generic" uses standard IMAP SEARCH, flags, configurable mailbox.
 */

import type { EmailLabel } from "./types.js";

/** Gmail-specific exclude labels (categories + system labels). */
export const GMAIL_DEFAULT_EXCLUDE_LABELS: readonly EmailLabel[] = [
	"category:promotions",
	"category:social",
	"SPAM",
	"TRASH",
] as EmailLabel[];

/** Generic IMAP: no label-based exclusion (search all in mailbox). */
export const GENERIC_DEFAULT_EXCLUDE_LABELS: readonly EmailLabel[] = [];

export type ImapProvider = "gmail" | "generic";

/** Connection params for IMAP. */
interface ImapConnectionConfig {
	readonly host: string;
	readonly port: number;
	readonly secure: boolean;
	readonly mailbox: string;
}

/** How to mark processed messages: Gmail labels vs IMAP flags. */
export type MarkProcessedStrategy = "label" | "flag";

/** Full IMAP provider config — connection + search + mark-processed behavior. */
export interface ImapProviderConfig extends ImapConnectionConfig {
	readonly provider: ImapProvider;
	readonly defaultExcludeLabels: readonly EmailLabel[];
	readonly markProcessedStrategy: MarkProcessedStrategy;
	/** Label name (Gmail) or flag name (generic, e.g. $Paperless). */
	readonly markProcessedLabel: EmailLabel;
}

/** Gmail preset. */
export const GMAIL_PRESET: Omit<ImapProviderConfig, "markProcessedLabel"> = {
	provider: "gmail",
	host: "imap.gmail.com",
	port: 993,
	secure: true,
	mailbox: "[Gmail]/All Mail",
	defaultExcludeLabels: [...GMAIL_DEFAULT_EXCLUDE_LABELS],
	markProcessedStrategy: "label",
} as const;

/** Build ImapProviderConfig from metadata + global config. */
export function resolveImapConfig(
	provider: ImapProvider,
	markProcessedLabel: EmailLabel,
	overrides?: {
		host?: string;
		port?: number;
		secure?: boolean;
		mailbox?: string;
	},
): ImapProviderConfig {
	if (provider === "gmail") {
		return {
			...GMAIL_PRESET,
			markProcessedLabel,
		};
	}
	// generic
	const host = overrides?.host ?? "localhost";
	const port = overrides?.port ?? 993;
	const secure = overrides?.secure ?? true;
	const mailbox = overrides?.mailbox ?? "INBOX";
	return {
		provider: "generic",
		host,
		port,
		secure,
		mailbox,
		defaultExcludeLabels: GENERIC_DEFAULT_EXCLUDE_LABELS,
		markProcessedStrategy: "flag",
		markProcessedLabel: (markProcessedLabel || "$Paperless") as EmailLabel,
	};
}
