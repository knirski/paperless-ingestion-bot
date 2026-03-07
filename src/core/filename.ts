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

/** Build base filename for Signal attachment (customFilename or attachmentId, with ext from contentType/fileType). */
export function buildSignalAttachmentBaseFilename(
	attachmentId: string,
	customFilename: string | undefined,
	contentType: string | undefined,
	fileType: { ext?: string } | undefined,
): string {
	const ext = extensionFromContentType(contentType) || (fileType?.ext ? `.${fileType.ext}` : "");
	let base = customFilename
		? safeFilename(customFilename.replace(/\.[^.]+$/, ""))
		: `signal_${attachmentId}`;
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
		: `attachment_${fallbackIndex}`;
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
