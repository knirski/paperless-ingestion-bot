/**
 * Generic MIME utilities — no app-specific logic.
 *
 * Used by: core/eligibility, core/filename, core/ollama.
 * Ingestion-specific rules (eligible prefixes, blocked types) live in core/eligibility.ts.
 */

import mime from "mime";

/** Content-Type header value; absent when undefined. */
export type ContentType = string | undefined;

/** Extract base MIME type from Content-Type (e.g. "image/png; charset=utf-8" → "image/png"). */
export function parseContentTypeBase(contentType: string): string {
	return (contentType.toLowerCase().split(";")[0] ?? "").trim();
}

/** Map Content-Type header to file extension (e.g. "application/pdf" → ".pdf"). */
export function extensionFromContentType(contentType: ContentType): string {
	if (contentType === undefined || !contentType.includes("/")) return "";
	const ext = mime.getExtension(contentType);
	return ext ? `.${ext}` : "";
}
