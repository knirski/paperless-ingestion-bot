/**
 * Live Ollama client interpreter — uses effect/unstable/http HttpClient.
 * HttpClient is baked in at layer construction; interface hides it.
 */

import { Duration, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { parseOllamaYesNo } from "../core/index.js";
import { OllamaRequestError } from "../domain/errors.js";
import { redactedForLog, redactUrl, unknownToMessage } from "../domain/utils.js";
import type { OllamaClientService, OllamaRequest } from "../interfaces/ollama-client.js";

export class OllamaClient extends ServiceMap.Service<OllamaClient, OllamaClientService>()(
	"paperless-ingestion-bot/live/ollama-client",
) {
	static live: (baseUrl: string) => Layer.Layer<OllamaClient, never, HttpClient.HttpClient>;
}

const OLLAMA_TIMEOUT = Duration.seconds(60); // vision model inference

/** Ollama /api/generate response shape. */
const OllamaGenerateResponseSchema = Schema.Struct({
	response: Schema.optional(Schema.String),
});

function createOllamaClient(baseUrl: string, client: HttpClient.HttpClient): OllamaClientService {
	const base = baseUrl.replace(/\/$/, "");
	const url = `${base}/api/generate`;
	return OllamaClient.of({
		assess: Effect.fn("paperless-ingestion-bot/live/ollama-client.assess")(function* (
			request: OllamaRequest,
		) {
			return yield* Effect.gen(function* () {
				const payload: Record<string, unknown> = {
					model: request.model,
					prompt: request.prompt,
					stream: request.stream ?? false,
				};
				if (request.images?.length) payload.images = [...request.images];

				const req = HttpClientRequest.post(url, {
					body: HttpBody.jsonUnsafe(payload),
				});
				const resOpt = yield* client.execute(req).pipe(Effect.timeoutOption(OLLAMA_TIMEOUT));
				const result = yield* Option.match(resOpt, {
					onNone: () => Effect.succeed(true), // timeout -> fail-open
					onSome: (res) =>
						Effect.gen(function* () {
							if (res.status >= 400) return true; // fail-open on Ollama errors
							const raw = yield* res.json;
							const decoded = Schema.decodeUnknownOption(OllamaGenerateResponseSchema)(raw);
							const text = Option.match(decoded, {
								onNone: () => "",
								onSome: (d) => d.response ?? "",
							});
							return parseOllamaYesNo(text);
						}),
				});
				return result;
			}).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.mapError(
					(e) =>
						new OllamaRequestError({
							url: redactedForLog(url, redactUrl),
							message: unknownToMessage(e),
						}),
				),
			);
		}),
	});
}

/** Live layer for OllamaClient. Requires baseUrl (e.g. from EmailConfig). */
OllamaClient.live = (baseUrl: string) =>
	Layer.effect(OllamaClient)(
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			return createOllamaClient(baseUrl, client);
		}),
	);
