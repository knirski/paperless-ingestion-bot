/**
 * Live PaperlessClient interpreter — uploads documents via Paperless-ngx REST API.
 * Uses effect/unstable/http HttpClient.
 */

import { Effect, Layer, Ref, ServiceMap } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { formatErrorForStructuredLog, PaperlessApiError } from "../domain/errors.js";
import type { TagId, TagName } from "../domain/paperless-types.js";
import { redactedForLog, redactUrl, unknownToMessage } from "../domain/utils.js";
import type { PaperlessClientService } from "../interfaces/paperless-client.js";

/** Paperless-ngx API version for Accept header. Must match ALLOWED_VERSIONS in paperless-ngx settings. */
export const PAPERLESS_NGX_ACCEPT_VERSION = "9";

export class PaperlessClient extends ServiceMap.Service<PaperlessClient, PaperlessClientService>()(
	"paperless-ingestion-bot/live/paperless-client",
) {
	static live: (
		baseUrl: string,
		token: string,
	) => Layer.Layer<PaperlessClient, never, HttpClient.HttpClient>;
}

function createPaperlessClient(
	baseUrl: string,
	token: string,
	client: HttpClient.HttpClient,
	tagCacheRef: Ref.Ref<Map<TagName, TagId>>,
): PaperlessClientService {
	const base = baseUrl.replace(/\/$/, "");
	const postDocumentUrl = `${base}/api/documents/post_document/`;
	const tagsBaseUrl = `${base}/api/tags/`;

	const headers = {
		Authorization: `Token ${token}`,
		Accept: `application/json; version=${PAPERLESS_NGX_ACCEPT_VERSION}`,
	};

	const toPaperlessError = (url: string, e: unknown) =>
		new PaperlessApiError({
			status: 0,
			url: redactedForLog(url, redactUrl),
			message: unknownToMessage(e),
		});

	/** Resolve a single tag name to ID. GET by name; if not found, POST to create. Uses cache. */
	const resolveOneTag = Effect.fn("paperless-client.resolveOneTag")(function* (
		name: TagName,
		tagCache: Ref.Ref<Map<TagName, TagId>>,
	) {
		const key = name;
		const cache = yield* Ref.get(tagCache);
		const cached = cache.get(key);
		if (cached !== undefined) return cached;

		const checkUrl = `${tagsBaseUrl}?name__iexact=${encodeURIComponent(String(name))}`;
		const checkReq = HttpClientRequest.get(checkUrl, { headers });
		const checkRes = yield* client
			.execute(checkReq)
			.pipe(Effect.mapError((e) => toPaperlessError(checkUrl, e)));
		if (checkRes.status >= 400) {
			yield* Effect.fail(
				new PaperlessApiError({
					status: checkRes.status,
					url: redactedForLog(checkUrl, redactUrl),
					message: `Failed to fetch tag "${String(name)}": ${checkRes.status}`,
				}),
			);
		}
		const body = (yield* checkRes.json) as { results?: { id: number; name: string }[] };
		const results = body.results ?? [];
		const first = results[0];
		let id: TagId;
		if (first !== undefined) {
			id = first.id as TagId;
		} else {
			const createReq = HttpClientRequest.post(`${base}/api/tags/`, {
				headers: { ...headers, "Content-Type": "application/json" },
				body: HttpBody.jsonUnsafe({ name: String(name) }),
			});
			const createRes = yield* client
				.execute(createReq)
				.pipe(Effect.mapError((e) => toPaperlessError(tagsBaseUrl, e)));
			if (createRes.status >= 400) {
				const errBody = yield* createRes.text;
				yield* Effect.fail(
					new PaperlessApiError({
						status: createRes.status,
						url: redactedForLog(tagsBaseUrl, redactUrl),
						message: `Failed to create tag "${String(name)}": ${errBody}`,
					}),
				);
			}
			const created = (yield* createRes.json) as { id: number; name: string };
			id = created.id as TagId;
		}
		const nextCache = new Map(cache);
		nextCache.set(key, id);
		yield* Ref.set(tagCache, nextCache);
		return id;
	});

	/** Resolve tag names to IDs. Uses in-memory cache to avoid repeated API calls. */
	const resolveTags = Effect.fn("paperless-client.resolveTags")(function* (
		tagNames: readonly TagName[],
		tagCache: Ref.Ref<Map<TagName, TagId>>,
	) {
		if (tagNames.length === 0) return [] as TagId[];
		const ids = yield* Effect.forEach(tagNames, (name) => resolveOneTag(name, tagCache));
		return ids;
	});

	const service: PaperlessClientService = {
		uploadDocument: (document: Uint8Array, filename: string, tags: readonly TagName[]) =>
			Effect.fn("paperless-client.uploadDocument")(function* () {
				const tagIds = yield* resolveTags(tags, tagCacheRef).pipe(
					Effect.mapError(
						(e) =>
							new PaperlessApiError({
								status: 0,
								url: redactedForLog(postDocumentUrl, redactUrl),
								message: unknownToMessage(e),
							}),
					),
				);

				const formData = new FormData();
				formData.append("document", new Blob([new Uint8Array(document)]), filename);
				for (const id of tagIds) {
					formData.append("tags", String(id));
				}

				const req = HttpClientRequest.post(postDocumentUrl, {
					headers: {
						Authorization: `Token ${token}`,
						Accept: `application/json; version=${PAPERLESS_NGX_ACCEPT_VERSION}`,
					},
					body: HttpBody.formData(formData),
				});

				const res = yield* client.execute(req).pipe(
					Effect.mapError(
						(e) =>
							new PaperlessApiError({
								status: 0,
								url: redactedForLog(postDocumentUrl, redactUrl),
								message: unknownToMessage(e),
							}),
					),
				);

				if (res.status >= 400) {
					const errBody = yield* res.text;
					yield* Effect.fail(
						new PaperlessApiError({
							status: res.status,
							url: redactedForLog(postDocumentUrl, redactUrl),
							message: errBody || `HTTP ${res.status}`,
						}),
					);
				}
			})().pipe(
				Effect.tapError((e) =>
					Effect.logError({
						event: "paperless_upload_failed",
						filename,
						...(e instanceof PaperlessApiError ? { status: e.status } : {}),
						error: formatErrorForStructuredLog(e),
					}),
				),
				Effect.mapError((e) =>
					e instanceof PaperlessApiError
						? e
						: new PaperlessApiError({
								status: 0,
								url: redactedForLog(postDocumentUrl, redactUrl),
								message: unknownToMessage(e),
							}),
				),
			),
	};
	return PaperlessClient.of(service);
}

/** Live layer for PaperlessClient. Requires baseUrl and token. */
PaperlessClient.live = (baseUrl: string, token: string) =>
	Layer.effect(PaperlessClient)(
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const tagCacheRef = yield* Ref.make(new Map<TagName, TagId>());
			return createPaperlessClient(baseUrl, token, client, tagCacheRef);
		}),
	);
