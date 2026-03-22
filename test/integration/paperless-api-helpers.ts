/**
 * Paperless API test helpers. HTTP + Schema decode, polling, token.
 * Shared by paperless-api live integration tests.
 */

import { Duration, Effect, Schedule, Schema } from "effect";
import * as Http from "effect/unstable/http";
import { PAPERLESS_NGX_ACCEPT_VERSION } from "../../src/live/paperless-client.js";

const httpLayer = Http.FetchHttpClient.layer;

const PAPERLESS_ACCEPT = `application/json; version=${PAPERLESS_NGX_ACCEPT_VERSION}`;

// Schemas for Paperless API responses
const TokenResponseSchema = Schema.Struct({ token: Schema.String });
const TagsListSchema = Schema.Struct({
	results: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String }))),
});
const DocumentListItemSchema = Schema.Struct({
	id: Schema.Number,
	original_file_name: Schema.optional(Schema.String),
	tags: Schema.optional(Schema.Array(Schema.Number)),
});
const DocumentListSchema = Schema.Struct({
	count: Schema.Number,
	results: Schema.optional(Schema.Array(DocumentListItemSchema)),
});

type DocumentList = Schema.Schema.Type<typeof DocumentListSchema>;
type DocumentListItem = Schema.Schema.Type<typeof DocumentListItemSchema>;
type PaperlessApiRequestError = Http.HttpClientError.HttpClientError | Schema.SchemaError;

type PaperlessAuthHeaders = { Authorization: string; Accept: string };

function paperlessAuthHeaders(token: string): PaperlessAuthHeaders {
	return {
		Authorization: `Token ${token}`,
		Accept: PAPERLESS_ACCEPT,
	};
}

function apiUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

const API_JSON_HEADERS: { "Content-Type": string; Accept: string } = {
	"Content-Type": "application/json",
	Accept: PAPERLESS_ACCEPT,
};

/** GET and return status only (no body parsing). For asserting 401 etc. */
export function apiGetStatus(
	baseUrl: string,
	path: string,
	token: string,
): Effect.Effect<number, Http.HttpClientError.HttpClientError, never> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const res = yield* client.get(apiUrl(baseUrl, path), {
			headers: paperlessAuthHeaders(token),
		});
		return res.status;
	}).pipe(Effect.provide(httpLayer));
}

/**
 * Generic GET + schema decode for Paperless API.
 * Type assertion needed: Effect infers Requirements as unknown despite provide(httpLayer).
 */
function apiGet<R>(
	baseUrl: string,
	path: string,
	token: string,
	schema: Schema.Schema<R>,
): Effect.Effect<R, PaperlessApiRequestError, never> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const res = yield* client.get(apiUrl(baseUrl, path), {
			headers: paperlessAuthHeaders(token),
		});
		return yield* Http.HttpClientResponse.filterStatusOk(res).pipe(
			Effect.flatMap(Http.HttpClientResponse.schemaBodyJson(schema)),
		);
	}).pipe(Effect.provide(httpLayer)) as Effect.Effect<R, PaperlessApiRequestError, never>;
}

export function apiGetTags(baseUrl: string, nameFilter: string, token: string) {
	return apiGet(
		baseUrl,
		`/api/tags/?name__iexact=${encodeURIComponent(nameFilter)}`,
		token,
		TagsListSchema,
	);
}

export function apiGetDocuments(baseUrl: string, token: string, opts?: { pageSize?: number }) {
	const path =
		opts?.pageSize != null ? `/api/documents/?page_size=${opts.pageSize}` : "/api/documents/";
	return apiGet(baseUrl, path, token, DocumentListSchema);
}

function apiGetDocumentsByTag(baseUrl: string, tagName: string, token: string) {
	return apiGet(
		baseUrl,
		`/api/documents/?tags__name__iexact=${encodeURIComponent(tagName)}`,
		token,
		DocumentListSchema,
	);
}

function apiGetDocumentsByTagId(baseUrl: string, tagId: number, token: string) {
	return apiGet(baseUrl, `/api/documents/?tags__id__all=${tagId}`, token, DocumentListSchema);
}

type PollOptions = { maxAttempts?: number; intervalMs?: number };

const DEFAULT_POLL_OPTIONS: Required<PollOptions> = {
	maxAttempts: 15,
	intervalMs: 2000,
};

function pollSchedule(options: PollOptions) {
	const { maxAttempts, intervalMs } = { ...DEFAULT_POLL_OPTIONS, ...options };
	return Schedule.spaced(Duration.millis(intervalMs)).pipe(
		Schedule.compose(Schedule.recurs(maxAttempts - 1)),
	);
}

/** Poll until fetch returns a result satisfying isReady. */
function pollUntil<T, E>(
	fetch: Effect.Effect<T, E>,
	isReady: (t: T) => boolean,
	failureMsg: (maxAttempts: number) => string,
	options: PollOptions = {},
): Effect.Effect<T, Error | E> {
	const { maxAttempts } = { ...DEFAULT_POLL_OPTIONS, ...options };
	const attempt = Effect.gen(function* () {
		const res = yield* fetch;
		if (isReady(res)) return res;
		return yield* Effect.fail(new Error(failureMsg(maxAttempts)));
	});
	return attempt.pipe(Effect.retry(pollSchedule(options))) as Effect.Effect<T, Error | E>;
}

export function pollUntilDocumentWithTag(
	baseUrl: string,
	token: string,
	tagName: string,
	options: PollOptions = {},
): Effect.Effect<DocumentList, Error> {
	return pollUntil(
		apiGetDocumentsByTag(baseUrl, tagName, token),
		(r) => (r.results?.length ?? 0) >= 1,
		(maxAttempts) => `Document with tag "${tagName}" did not appear after ${maxAttempts} attempts`,
		options,
	);
}

export function pollUntilDocumentWithTagId(
	baseUrl: string,
	token: string,
	tagId: number,
	options: PollOptions = {},
): Effect.Effect<DocumentList, Error> {
	return pollUntil(
		apiGetDocumentsByTagId(baseUrl, tagId, token),
		(r) => (r.results?.length ?? 0) >= 1,
		(maxAttempts) => `Document with tag ID ${tagId} did not appear after ${maxAttempts} attempts`,
		options,
	);
}

/** Poll with page_size to ensure new doc is in first page when many docs exist. */
export function pollUntilDocumentWithFilename(
	baseUrl: string,
	token: string,
	filename: string,
	options: PollOptions = {},
): Effect.Effect<DocumentList, Error> {
	return pollUntil(
		apiGetDocuments(baseUrl, token, { pageSize: 100 }),
		(r) => r.results?.some((d: DocumentListItem) => d.original_file_name === filename) === true,
		(maxAttempts) =>
			`Document with filename "${filename}" did not appear after ${maxAttempts} attempts`,
		options,
	);
}

type TokenCredentials = {
	PAPERLESS_ADMIN_USER: string;
	PAPERLESS_ADMIN_PASSWORD: string;
};

export function apiPostToken(
	baseUrl: string,
	creds: TokenCredentials,
): Effect.Effect<string, PaperlessApiRequestError, never> {
	return Effect.gen(function* () {
		const client = yield* Http.HttpClient.HttpClient;
		const res = yield* client.post(apiUrl(baseUrl, "/api/token/"), {
			headers: API_JSON_HEADERS,
			body: Http.HttpBody.jsonUnsafe({
				username: creds.PAPERLESS_ADMIN_USER,
				password: creds.PAPERLESS_ADMIN_PASSWORD,
			}),
		});
		const body = yield* Http.HttpClientResponse.filterStatusOk(res).pipe(
			Effect.flatMap(Http.HttpClientResponse.schemaBodyJson(TokenResponseSchema)),
		);
		return body.token;
	}).pipe(Effect.provide(httpLayer));
}

/** Find document in list by original_file_name. */
export function findDocByFilename(
	docList: DocumentList,
	filename: string,
): DocumentListItem | undefined {
	return docList.results?.find((d) => d.original_file_name === filename);
}
