/** Domain errors — discriminated union for shell pattern-matching.
 *
 * Flat payloads (no nested Cause). Idiomatic Effect: Fail = typed domain errors, Die = defects.
 *
 * ## Optional fields
 *
 * - **ConfigValidationError**: `path` — not all validation failures are file-related; `fix` — only when we have a concrete suggestion.
 * - **SignalApiHttpError**: `message` — HTTP 4xx/5xx or underlying error text.
 * - **FileSystemError**: `fix` — only when we have a concrete suggestion.
 * - **KeyringError**: `fix` — always present (libsecret hint).
 * - **ConfigParseError**: `fix` — only when we have a hint (e.g. users.json template).
 */

import { Match, Schema } from "effect";
import { AttachmentIdSchema, SignalNumberSchema } from "./signal-types.js";
import { AccountEmailSchema } from "./types.js";
import { errorToLogMessage, redactedForLog, redactPath, unknownToMessage } from "./utils.js";

export class InvalidEmailError extends Schema.TaggedErrorClass<InvalidEmailError>()(
	"InvalidEmailError",
	{ email: Schema.Redacted(Schema.String) },
) {}

export class AppPasswordTooShortError extends Schema.TaggedErrorClass<AppPasswordTooShortError>()(
	"AppPasswordTooShortError",
	{ message: Schema.String },
) {}

export class IneligibleAttachmentError extends Schema.TaggedErrorClass<IneligibleAttachmentError>()(
	"IneligibleAttachmentError",
	{ message: Schema.String },
) {}

/** Config validation errors (no users, invalid config, keyring unavailable, etc.). */
export class ConfigValidationError extends Schema.TaggedErrorClass<ConfigValidationError>()(
	"ConfigValidationError",
	{
		message: Schema.String,
		path: Schema.optional(Schema.Redacted(Schema.String)),
		fix: Schema.optional(Schema.String),
	},
) {}

export class UnauthorizedUserError extends Schema.TaggedErrorClass<UnauthorizedUserError>()(
	"UnauthorizedUserError",
	{ source: Schema.Redacted(SignalNumberSchema) },
) {}

export class SignalApiHttpError extends Schema.TaggedErrorClass<SignalApiHttpError>()(
	"SignalApiHttpError",
	{
		status: Schema.Number,
		url: Schema.Redacted(Schema.String),
		message: Schema.String,
	},
) {}

export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()("FileSystemError", {
	path: Schema.Redacted(Schema.String),
	operation: Schema.String,
	message: Schema.String,
	fix: Schema.optional(Schema.String),
}) {}

/** Wrap raw FS errors as FileSystemError. Use with Effect.mapError. */
export function wrapFs(path: string, op: string, fix?: string) {
	return (e: unknown) =>
		new FileSystemError({
			path: redactedForLog(path, redactPath),
			operation: op,
			message: unknownToMessage(e),
			fix,
		});
}

/** System keychain errors (unavailable, init failed, get/set/delete failed). */
export class KeyringError extends Schema.TaggedErrorClass<KeyringError>()("KeyringError", {
	message: Schema.String,
	operation: Schema.optional(Schema.String),
	fix: Schema.String,
}) {}

export class AttachmentTooLargeError extends Schema.TaggedErrorClass<AttachmentTooLargeError>()(
	"AttachmentTooLargeError",
	{
		size: Schema.Number,
		maxSize: Schema.Number,
		attachmentId: Schema.optional(AttachmentIdSchema),
	},
) {}

export class PayloadTooLargeError extends Schema.TaggedErrorClass<PayloadTooLargeError>()(
	"PayloadTooLargeError",
	{ size: Schema.Number, maxSize: Schema.Number },
) {}

export class OllamaRequestError extends Schema.TaggedErrorClass<OllamaRequestError>()(
	"OllamaRequestError",
	{ url: Schema.Redacted(Schema.String), message: Schema.String },
) {}

export class ImapConnectionError extends Schema.TaggedErrorClass<ImapConnectionError>()(
	"ImapConnectionError",
	{ email: Schema.Redacted(AccountEmailSchema), message: Schema.String },
) {}

/** File parse errors (config, credentials, users.json). path + message required. */
export class ConfigParseError extends Schema.TaggedErrorClass<ConfigParseError>()(
	"ConfigParseError",
	{
		path: Schema.Redacted(Schema.String),
		message: Schema.String,
		fix: Schema.optional(Schema.String),
	},
) {}

export type DomainError =
	| InvalidEmailError
	| AppPasswordTooShortError
	| IneligibleAttachmentError
	| ConfigValidationError
	| UnauthorizedUserError
	| SignalApiHttpError
	| AttachmentTooLargeError
	| PayloadTooLargeError
	| OllamaRequestError
	| ImapConnectionError
	| ConfigParseError
	| FileSystemError
	| KeyringError;

function formatWithFix(base: string, fix?: string): string {
	return fix ? `${base}. Fix: ${fix}` : base;
}

/** Format domain error for logs. Redacted fields: use r.label ?? "<redacted>". */
export const formatDomainError: (err: DomainError) => string = Match.type<DomainError>().pipe(
	Match.tag(
		"InvalidEmailError",
		({ email }) => `Invalid email format: ${email.label ?? "<redacted>"}`,
	),
	Match.tag("AppPasswordTooShortError", ({ message }) => message),
	Match.tag("IneligibleAttachmentError", ({ message }) => message),
	Match.tag("ConfigValidationError", ({ message, path, fix }) =>
		formatWithFix(`${path ? `${path.label ?? "<redacted>"}: ` : ""}${message}`, fix),
	),
	Match.tag(
		"UnauthorizedUserError",
		({ source }) => `Unknown Signal number: ${source.label ?? "<redacted>"}`,
	),
	Match.tag("SignalApiHttpError", ({ status, url, message }) =>
		status === 0 ? message : `Signal API HTTP ${status} at ${url.label ?? "<redacted>"}`,
	),
	Match.tag("FileSystemError", ({ path, operation, message, fix }) =>
		formatWithFix(
			`File system error: ${operation} at ${path.label ?? "<redacted>"} (${message})`,
			fix,
		),
	),
	Match.tag("KeyringError", ({ message, operation, fix }) =>
		formatWithFix(
			operation ? `Keyring error (${operation}): ${message}` : `Keyring error: ${message}`,
			fix,
		),
	),
	Match.tag(
		"AttachmentTooLargeError",
		({ size, maxSize }) => `Attachment too large: ${size} bytes (max ${maxSize})`,
	),
	Match.tag(
		"PayloadTooLargeError",
		({ size, maxSize }) => `Payload too large: ${size} bytes (max ${maxSize})`,
	),
	Match.tag(
		"OllamaRequestError",
		({ url, message }) => `Ollama request failed: ${url.label ?? "<redacted>"} (${message})`,
	),
	Match.tag(
		"ImapConnectionError",
		({ email, message }) =>
			`IMAP connection failed for ${email.label ?? "<redacted>"} (${message})`,
	),
	Match.tag("ConfigParseError", ({ path, message, fix }) =>
		formatWithFix(`Config parse error at ${path.label ?? "<redacted>"}: ${message}`, fix),
	),
	Match.exhaustive,
);

/** Format error for structured logs. DomainError via formatDomainError, else unknownToMessage. */
export const formatErrorForStructuredLog = (e: unknown) =>
	errorToLogMessage(e, (err) => formatDomainError(err as DomainError));
