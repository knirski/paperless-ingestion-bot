/**
 * Signal webhook types and identifiers (signal-cli-rest-api).
 */

import { Option, Schema } from "effect";

/** E.164-like pattern: optional +, 10–15 digits. */
const E164_PATTERN = /^\+?[1-9]\d{9,14}$/;

/** Branded type for Signal phone number (E.164). */
export const SignalNumberSchema = Schema.String.pipe(
	Schema.check(
		Schema.isPattern(E164_PATTERN, {
			expected: "Invalid Signal number format (expected E.164)",
		}),
	),
	Schema.brand("SignalNumber"),
);
export type SignalNumber = Schema.Schema.Type<typeof SignalNumberSchema>;

/**
 * Branded type for Signal attachment ID (from webhook).
 * A branded type is a primitive (here, string) with a phantom "brand" that makes it
 * distinct from other strings at compile time. You can't pass a random string where
 * AttachmentId is expected — you must obtain it from the right boundary (e.g. decode).
 */
export const AttachmentIdSchema = Schema.String.pipe(Schema.brand("AttachmentId"));
export type AttachmentId = Schema.Schema.Type<typeof AttachmentIdSchema>;

/**
 * Signal webhook payload (signal-cli-rest-api).
 * Supports raw JSON-RPC (params.envelope) and flattened format (envelope at top level).
 * Source and dataMessage can appear nested in envelope or flattened at top level;
 * different signal-cli setups send different shapes, so we accept both.
 */
export interface SignalWebhookPayload {
	/** JSON-RPC params — envelope from signal-cli receive notification. */
	readonly params?: {
		readonly envelope?: SignalEnvelope;
		readonly result?: { readonly envelope?: SignalEnvelope };
	};
	/** Flattened envelope (when not wrapped in params). */
	readonly envelope?: SignalEnvelope;
	/** Flattened source/sourceNumber. */
	readonly source?: string | { readonly number?: string };
	readonly sourceNumber?: string;
	readonly dataMessage?: SignalDataMessage;
}

/** Envelope within Signal webhook payload. */
export interface SignalEnvelope {
	readonly source?: string | { readonly number?: string };
	readonly sourceNumber?: string;
	readonly dataMessage?: SignalDataMessage;
}

/**
 * Data message within Signal webhook.
 * Protocol uses `body`; signal-cli JSON-RPC uses `message` — support both.
 */
export interface SignalDataMessage {
	readonly body?: string;
	readonly message?: string;
	readonly attachments?: readonly SignalAttachmentRef[];
}

/** Attachment reference from Signal webhook (signald JsonAttachment). */
export interface SignalAttachmentRef {
	readonly id?: string;
	readonly customFilename?: string;
	readonly contentType?: string;
}

// --- Schemas for webhook payload validation ---

const SourceSchema = Schema.Union([
	Schema.String,
	Schema.Struct({ number: Schema.optional(Schema.String) }),
]);

const SignalAttachmentRefSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	customFilename: Schema.optional(Schema.String),
	contentType: Schema.optional(Schema.String),
});

const SignalDataMessageSchema = Schema.Struct({
	body: Schema.optional(Schema.String),
	message: Schema.optional(Schema.String),
	attachments: Schema.optional(Schema.Array(SignalAttachmentRefSchema)),
});

const SignalEnvelopeSchema = Schema.Struct({
	source: Schema.optional(SourceSchema),
	sourceNumber: Schema.optional(Schema.String),
	dataMessage: Schema.optional(SignalDataMessageSchema),
});

const SignalWebhookPayloadSchema = Schema.Struct({
	params: Schema.optional(
		Schema.Struct({
			envelope: Schema.optional(SignalEnvelopeSchema),
			result: Schema.optional(Schema.Struct({ envelope: Schema.optional(SignalEnvelopeSchema) })),
		}),
	),
	envelope: Schema.optional(SignalEnvelopeSchema),
	source: Schema.optional(SourceSchema),
	sourceNumber: Schema.optional(Schema.String),
	dataMessage: Schema.optional(SignalDataMessageSchema),
});

/** Decode webhook body to SignalWebhookPayload. Returns empty payload on invalid input. */
export function decodeWebhookPayload(body: unknown): SignalWebhookPayload {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return {};
	}
	const decoded = Schema.decodeUnknownOption(SignalWebhookPayloadSchema)(body);
	const value = Option.getOrUndefined(decoded);
	return (value ?? {}) as SignalWebhookPayload;
}

// --- Helpers ---

/** Extract Signal attachment ref from webhook attachment object. */
export function parseSignalAttachmentRef(obj: Partial<SignalAttachmentRef>): SignalAttachmentRef {
	const id = typeof obj.id === "string" ? obj.id : undefined;
	const customFilename = typeof obj.customFilename === "string" ? obj.customFilename : undefined;
	const contentType = typeof obj.contentType === "string" ? obj.contentType : undefined;
	return {
		...(id !== undefined && { id }),
		...(customFilename !== undefined && { customFilename }),
		...(contentType !== undefined && { contentType }),
	};
}

/** Extract envelope from webhook payload (flattened, params.envelope, or params.result.envelope). */
export function getEnvelope(data: SignalWebhookPayload): Option.Option<SignalEnvelope> {
	const env = data.envelope ?? data.params?.envelope ?? data.params?.result?.envelope;
	return Option.fromNullishOr(env);
}

/** Extract data message from webhook payload (toplevel or from envelope). */
export function getDataMessage(data: SignalWebhookPayload): Option.Option<SignalDataMessage> {
	const dm = data.dataMessage ?? Option.getOrNull(getEnvelope(data))?.dataMessage;
	return Option.fromNullishOr(dm);
}

/** Extract trimmed text body from data message (body or message field). */
export function getDataMessageBody(dm: SignalDataMessage): string {
	return (dm.body ?? dm.message ?? "").trim();
}

function toSourceString(v: unknown): string | undefined {
	if (typeof v === "string") return v;
	if (v && typeof v === "object" && typeof (v as { number?: unknown }).number === "string") {
		return (v as { number: string }).number;
	}
	return undefined;
}

/** Extract Signal source number from webhook payload (toplevel, envelope, or params.envelope). */
export function resolveSignalSource(data: SignalWebhookPayload): Option.Option<SignalNumber> {
	const env = Option.getOrNull(getEnvelope(data));
	const s =
		toSourceString(data.source) ??
		toSourceString(data.sourceNumber) ??
		toSourceString(env?.source) ??
		toSourceString(env?.sourceNumber);
	if (!s) return Option.none();
	return Schema.decodeUnknownOption(SignalNumberSchema)(s);
}
