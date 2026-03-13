/**
 * Tagged domain errors for auto-PR scripts.
 * Uses Schema.TaggedErrorClass to align with src/domain/errors.ts.
 */

import { Match, Schema } from "effect";
import { formatDomainError } from "../../src/domain/errors.js";
import { errorToLogMessage } from "../../src/domain/utils.js";
export class GhPrFailed extends Schema.TaggedErrorClass<GhPrFailed>()("GhPrFailed", {
	cause: Schema.String,
}) {}

export class OllamaHttpError extends Schema.TaggedErrorClass<OllamaHttpError>()("OllamaHttpError", {
	status: Schema.optional(Schema.Number),
	cause: Schema.String,
}) {}

export class AutoPrConfigError extends Schema.TaggedErrorClass<AutoPrConfigError>()(
	"AutoPrConfigError",
	{ missing: Schema.Array(Schema.String) },
) {}

export class PrTitleBlank extends Schema.TaggedErrorClass<PrTitleBlank>()("PrTitleBlank", {
	message: Schema.String,
}) {}

/** Parse error for commit message parsing failures. Used by fill-pr-template. */
export class ParseError extends Schema.TaggedErrorClass<ParseError>()("ParseError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/** Format script errors for logs. Delegates to formatDomainError for FileSystemError and other domain errors. */
export function formatAutoPrError(e: unknown): string {
	if (
		e instanceof GhPrFailed ||
		e instanceof OllamaHttpError ||
		e instanceof AutoPrConfigError ||
		e instanceof PrTitleBlank ||
		e instanceof ParseError
	) {
		return Match.value(e).pipe(
			Match.tag("GhPrFailed", ({ cause }) => cause),
			Match.tag("OllamaHttpError", ({ status, cause }) =>
				status != null ? `Ollama HTTP ${status}: ${cause}` : cause,
			),
			Match.tag(
				"AutoPrConfigError",
				({ missing }) => `Missing required env: ${missing.join(", ")}`,
			),
			Match.tag("PrTitleBlank", ({ message }) => message),
			Match.tag("ParseError", ({ message, cause }) =>
				cause != null ? `${message}: ${String(cause)}` : message,
			),
			Match.exhaustive,
		);
	}
	return errorToLogMessage(e, (err) =>
		formatDomainError(err as Parameters<typeof formatDomainError>[0]),
	);
}
