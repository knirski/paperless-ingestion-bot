/**
 * Attachment eligibility for Paperless ingestion.
 *
 * Shared: ELIGIBLE_MIME_PREFIXES, isEligibleMime (used by email and Signal).
 * Email-specific: BLOCKED_EMAIL_MIME_TYPES, MIN_EMAIL_IMAGE_SIZE, junk filenames.
 * Used by shell/email-attachments and shell/signal-pipeline.
 */

import { Result } from "effect";
import { IneligibleAttachmentError } from "../domain/errors.js";
import { type ContentType, parseContentTypeBase } from "../domain/mime.js";

/** MIME prefixes/types accepted for Paperless ingestion (prefix match: "image/" covers all images). */
const ELIGIBLE_MIME_PREFIXES = [
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.",
	"application/rtf",
	"image/",
	"text/plain",
	"text/html",
	"text/csv",
] as const;

/** MIME types excluded from email ingestion (calendars, vcards, signatures, forwarded messages). */
const BLOCKED_EMAIL_MIME_TYPES = [
	"text/calendar",
	"application/ics",
	"text/x-vcard",
	"text/vcard",
	"application/pgp-signature",
	"application/pkcs7-signature",
	"application/x-pkcs7-signature",
	"message/rfc822",
] as const;

/** Min size (bytes) for email image attachments to be considered documents. */
export const MIN_EMAIL_IMAGE_SIZE = 100_000;

const JUNK_FILENAME_PATTERN =
	/(image\d{3}\.(png|jpg|gif|jpeg)|ATT\d+\.(png|jpg|gif|jpeg)|(logo|banner|spacer|icon|signature)\.(png|jpg|gif|jpeg|svg))/i;

/** Check if email attachment is eligible (blocked types, size, junk filenames, then isEligibleMime). */
export function isEmailAttachmentEligible(
	contentType: ContentType,
	filename: string | undefined,
	size: number,
): Result.Result<void, IneligibleAttachmentError> {
	if (!contentType) {
		return Result.fail(new IneligibleAttachmentError({ message: "Missing content type" }));
	}

	const ct = parseContentTypeBase(contentType);

	if (BLOCKED_EMAIL_MIME_TYPES.includes(ct as (typeof BLOCKED_EMAIL_MIME_TYPES)[number])) {
		return Result.fail(new IneligibleAttachmentError({ message: `Blocked MIME type: ${ct}` }));
	}

	if (ct.startsWith("image/") && size < MIN_EMAIL_IMAGE_SIZE) {
		return Result.fail(
			new IneligibleAttachmentError({
				message: `Image too small (${size} bytes < ${MIN_EMAIL_IMAGE_SIZE})`,
			}),
		);
	}

	if (filename && JUNK_FILENAME_PATTERN.test(filename)) {
		return Result.fail(new IneligibleAttachmentError({ message: `Junk filename: ${filename}` }));
	}

	return isEligibleMime(ct);
}

/** Check if MIME type is eligible for ingestion. Shared by email and Signal pipelines. */
export function isEligibleMime(mimeType: string): Result.Result<void, IneligibleAttachmentError> {
	const mimeLower = mimeType.toLowerCase();
	if (ELIGIBLE_MIME_PREFIXES.some((p) => mimeLower.startsWith(p))) {
		return Result.succeed(undefined);
	}
	return Result.fail(
		new IneligibleAttachmentError({ message: `Unsupported MIME type: ${mimeType}` }),
	);
}
