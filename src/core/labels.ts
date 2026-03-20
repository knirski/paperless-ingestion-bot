/**
 * Email label filtering and sanitization for Paperless tags.
 * Gmail labels get a "gmail-" prefix (e.g. category:promotions → gmail-category-promotions).
 * Pure functions — no Effect, no I/O.
 */

import type { TagName } from "../domain/paperless-types.js";
import { toTagName } from "../domain/paperless-types.js";
import type { EmailLabel } from "../domain/types.js";

/** Gmail system labels to filter out (not useful as document tags). */
const GMAIL_SYSTEM_LABELS = new Set([
	"INBOX",
	"UNREAD",
	"SENT",
	"DRAFT",
	"TRASH",
	"SPAM",
	"STARRED",
	"IMPORTANT",
	"[Gmail]/All Mail",
	"[Gmail]/Sent Mail",
	"[Gmail]/Drafts",
	"[Gmail]/Trash",
	"[Gmail]/Spam",
	"[Gmail]/Starred",
	"[Gmail]/Important",
]);

/** Sanitize a label for use as a Paperless tag name (e.g. category:promotions → category-promotions). */
function sanitizeLabelForTag(label: string): string {
	return label.replace(/:/g, "-");
}

/** Prefix for tags created from Gmail labels. Enables filtering; removable in bulk if needed. */
const GMAIL_LABEL_PREFIX = "gmail-";

/**
 * Filter system labels and sanitize email labels for Paperless tags.
 * Gmail labels get a "gmail-" prefix (e.g. category:promotions → gmail-category-promotions).
 * Returns TagName[] ready for uploadDocument.
 */
export function emailLabelsToTagNames(labels: readonly EmailLabel[]): TagName[] {
	const filtered = labels.filter((l) => !GMAIL_SYSTEM_LABELS.has(l) && !l.startsWith("[Gmail]/"));
	return filtered.map((l) => toTagName(`${GMAIL_LABEL_PREFIX}${sanitizeLabelForTag(l)}`));
}
