/**
 * Live SignalClient interpreter — uses effect/unstable/http HttpClient.
 */

import { Effect, Layer, Option, Schedule, Schema, ServiceMap } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { AttachmentTooLargeError, SignalApiHttpError } from "../domain/errors.js";
import {
	type AttachmentId,
	type SignalNumber,
	SignalNumberSchema,
} from "../domain/signal-types.js";
import { redactedForLog, redactUrl, unknownToMessage } from "../domain/utils.js";
import type { SignalClientService } from "../interfaces/signal-client.js";

export class SignalClient extends ServiceMap.Service<SignalClient, SignalClientService>()(
	"paperless-ingestion-bot/live/signal-client",
) {
	static live: (baseUrl: string) => Layer.Layer<SignalClient, never, HttpClient.HttpClient>;
}

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MiB

const retrySchedule = Schedule.exponential("1 second", 2).pipe(
	Schedule.compose(Schedule.recurs(2)),
);

function withRetry<T, E>(effect: Effect.Effect<T, E>): Effect.Effect<T, E> {
	return Effect.fn("paperless-ingestion-bot/live/signal-client.withRetry")(function* () {
		return yield* Effect.retry(effect, {
			while: () => true,
			schedule: retrySchedule,
		});
	})();
}

function toSignalApiError(url: string, e: unknown): SignalApiHttpError {
	return new SignalApiHttpError({
		status: 0,
		url: redactedForLog(url, redactUrl),
		message: unknownToMessage(e),
	});
}

export function createSignalClient(baseUrl: string): SignalClientService {
	const base = baseUrl.replace(/\/$/, "");
	return SignalClient.of({
		sendMessage: Effect.fn("paperless-ingestion-bot/live/signal-client.sendMessage")(function* (
			account: SignalNumber,
			recipient: SignalNumber,
			message: string,
		) {
			const url = `${base}/v2/send`;
			return yield* Effect.gen(function* () {
				const client = yield* HttpClient.HttpClient;
				const req = HttpClientRequest.post(url, {
					body: HttpBody.jsonUnsafe({
						number: account,
						recipients: [recipient as string],
						message,
					}),
				});
				const res = yield* client.execute(req).pipe(withRetry);
				if (res.status >= 400) {
					throw new SignalApiHttpError({
						status: res.status,
						url: redactedForLog(url, redactUrl),
						message: `HTTP ${res.status}`,
					});
				}
			}).pipe(Effect.mapError((e) => toSignalApiError(url, e)));
		}),

		getAccount: Effect.fn("paperless-ingestion-bot/live/signal-client.getAccount")(function* () {
			const url = `${base}/v1/accounts`;
			return yield* Effect.gen(function* () {
				const envAccount = process.env.SIGNAL_ACCOUNT;
				if (envAccount) {
					return Schema.decodeUnknownOption(SignalNumberSchema)(envAccount);
				}
				const client = yield* HttpClient.HttpClient;
				const res = yield* client.get(url);
				if (res.status >= 400) return Option.none();
				const data = (yield* res.json) as unknown;
				const accounts = Array.isArray(data) ? data : [];
				const first = accounts[0];
				if (typeof first !== "string") return Option.none();
				const decoded = Schema.decodeUnknownOption(SignalNumberSchema)(first);
				return decoded;
			}).pipe(Effect.mapError((e) => toSignalApiError(url, e)));
		}),

		fetchAttachment: Effect.fn("paperless-ingestion-bot/live/signal-client.fetchAttachment")(
			function* (attachmentId: AttachmentId) {
				const url = `${base}/v1/attachments/${attachmentId}`;
				return yield* Effect.gen(function* () {
					const client = yield* HttpClient.HttpClient;
					const res = yield* client.get(url).pipe(withRetry);
					if (res.status >= 400) {
						throw new SignalApiHttpError({
							status: res.status,
							url: redactedForLog(url, redactUrl),
							message: `HTTP ${res.status}`,
						});
					}
					const ab = yield* res.arrayBuffer;
					const arr = new Uint8Array(ab);
					if (arr.length > MAX_ATTACHMENT_SIZE) {
						throw new AttachmentTooLargeError({
							size: arr.length,
							maxSize: MAX_ATTACHMENT_SIZE,
							attachmentId,
						});
					}
					return arr;
				}).pipe(Effect.mapError((e) => toSignalApiError(url, e)));
			},
		),
	});
}

SignalClient.live = (baseUrl: string) => Layer.succeed(SignalClient)(createSignalClient(baseUrl));
