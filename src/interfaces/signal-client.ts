/**
 * SignalClient — abstract interface for signal-cli-rest-api.
 * Live interpreter uses HttpClient; tests provide mock.
 */

import type { Option } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { AttachmentId, SignalNumber } from "../domain/signal-types.js";
import type { AppEffect } from "../domain/types.js";

export interface SignalClientService {
	readonly sendMessage: (
		account: SignalNumber,
		recipient: SignalNumber,
		message: string,
	) => AppEffect<void, HttpClient.HttpClient>;
	readonly getAccount: () => AppEffect<Option.Option<SignalNumber>, HttpClient.HttpClient>;
	readonly fetchAttachment: (
		attachmentId: AttachmentId,
	) => AppEffect<Uint8Array, HttpClient.HttpClient>;
}
