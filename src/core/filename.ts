/**
 * Filename helpers — safe names, collision handling, extension from Content-Type.
 *
 * Uses domain/mime for extensionFromContentType. Used by email-attachments and signal-pipeline.
 */

import { type ContentType, extensionFromContentType } from "../domain/mime.js";

export function safeFilename(name: string, maxLen = 200): string {
	const sanitized = name.replace(/[<>:"/\\|?*]/g, "_");
	return sanitized.slice(0, maxLen) || "attachment";
}

/** Fallback stem when source has no filename. Pattern: unnamed_{source}_attachment_{id}. */
const UNNAMED_EMAIL_STEM = "unnamed_email_attachment";
const UNNAMED_SIGNAL_STEM = "unnamed_signal_attachment";

/** Build base filename for Signal attachment (customFilename or fallback, with ext from contentType/fileType). */
export function buildSignalAttachmentBaseFilename(
	attachmentId: string,
	customFilename: string | undefined,
	contentType: string | undefined,
	fileType: { ext?: string } | undefined,
): string {
	const ext = extensionFromContentType(contentType) || (fileType?.ext ? `.${fileType.ext}` : "");
	let base = customFilename
		? safeFilename(customFilename.replace(/\.[^.]+$/, ""))
		: `${UNNAMED_SIGNAL_STEM}_${attachmentId}`;
	if (ext && !base.toLowerCase().endsWith(ext.toLowerCase())) base += ext;
	return base;
}

/** Build base filename for email attachment (with optional ext from contentType). */
export function attachmentBaseFilename(
	filename: string | undefined,
	contentType: ContentType,
	fallbackIndex: number,
): string {
	const ext = extensionFromContentType(contentType);
	const base = filename
		? safeFilename(filename.replace(/\.[^.]+$/, ""))
		: `${UNNAMED_EMAIL_STEM}_${fallbackIndex}`;
	return ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
}

/** Split filename for collision handling: stem (no ext) + suffix (ext including dot). */
export function splitFilenameForCollision(baseFilename: string): { stem: string; suffix: string } {
	const stem = baseFilename.replace(/\.[^.]+$/, "");
	const suffix = baseFilename.includes(".")
		? baseFilename.slice(baseFilename.lastIndexOf("."))
		: "";
	return { stem, suffix };
}

/** Build collision-safe candidate: stem_idx suffix (e.g. doc_1.pdf). */
export function collisionCandidateFilename(stem: string, suffix: string, idx: number): string {
	return `${stem}_${idx}${suffix}`;
}
