/**
 * Signal attachment validation — pure functions for webhook attachment refs.
 */

import { Option, Result, Schema } from "effect";
import { InvalidAttachmentRefError } from "../domain/errors.js";
import {
	AttachmentIdSchema,
	type RawSignalAttachment,
	type SignalAttachmentRef,
} from "../domain/signal-types.js";

/**
 * Validate attachment refs from schema-decoded payload. Fail fast on first invalid (missing or bad id).
 * Call at earliest moment after extracting attachments from webhook payload.
 */
export function validateAttachmentsToRaw(
	attachments: readonly SignalAttachmentRef[],
): Result.Result<readonly RawSignalAttachment[], InvalidAttachmentRefError> {
	const out: RawSignalAttachment[] = [];
	for (const [i, att] of attachments.entries()) {
		if (!att.id || typeof att.id !== "string") {
			return Result.fail(
				new InvalidAttachmentRefError({
					message: "Attachment ref missing required id",
					index: i,
				}),
			);
		}
		const idOpt = Schema.decodeUnknownOption(AttachmentIdSchema)(att.id);
		const id = Option.getOrUndefined(idOpt);
		if (id === undefined) {
			return Result.fail(
				new InvalidAttachmentRefError({
					message: `Invalid attachment id: ${att.id}`,
					index: i,
				}),
			);
		}
		out.push({ ...att, id } as RawSignalAttachment);
	}
	return Result.succeed(out);
}
