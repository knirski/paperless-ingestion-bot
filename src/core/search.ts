/**
 * IMAP search — provider-agnostic.
 * Gmail uses X-GM-RAW (-label:X). Generic uses standard SEARCH (all in mailbox).
 */

import type { ImapProviderConfig } from "../domain/imap-provider.js";
import type { EmailLabel } from "../domain/types.js";

/** Search query for imapflow client.search(). */
export type ImapSearchQuery = { gmraw: string } | { all: true };

/** Returns merged, deduplicated exclude labels (defaults + account + processed). */
export function mergeExcludeLabels(
	defaults: readonly EmailLabel[],
	accountExcludeLabels: readonly EmailLabel[],
	markProcessedLabel: EmailLabel,
): EmailLabel[] {
	const labels = [
		...defaults,
		...accountExcludeLabels,
		...(markProcessedLabel ? [markProcessedLabel] : []),
	];
	return [...new Set(labels)];
}

/** Build Gmail X-GM-RAW search string from exclude labels. */
function buildGmailSearchString(excludeLabels: readonly EmailLabel[]): string {
	const query = excludeLabels
		.map((label) =>
			label.startsWith("category:") ? ` -category:${label.slice(9)}` : ` -label:${label}`,
		)
		.join("");
	return query.trim() || "all";
}

/** Build search query for IMAP. Gmail uses X-GM-RAW; generic uses ALL. */
export function buildSearch(
	imapConfig: ImapProviderConfig,
	excludeLabels: readonly EmailLabel[],
): ImapSearchQuery {
	if (imapConfig.provider === "gmail") {
		return { gmraw: buildGmailSearchString(excludeLabels) };
	}
	return { all: true };
}

export function emailToSlug(email: string): string {
	return email.toLowerCase().replace("@", "-").replace(/\./g, "-");
}
