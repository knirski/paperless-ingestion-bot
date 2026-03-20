/**
 * PaperlessClient — upload documents to Paperless-ngx via REST API.
 * Tagless Final: interface only; live interpreter in paperless-client.ts.
 */

import type { TagName } from "../domain/paperless-types.js";
import type { AppEffect } from "../domain/types.js";

export interface PaperlessClientService {
	/**
	 * Upload a document to Paperless with the given tags.
	 * Tag names are resolved to IDs (fetch/create as needed).
	 */
	readonly uploadDocument: (
		document: Uint8Array,
		filename: string,
		tags: readonly TagName[],
	) => AppEffect<void>;
}
