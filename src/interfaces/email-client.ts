/**
 * EmailClient — abstract interface for email (IMAP: Gmail and generic).
 * Live interpreter uses imapflow; tests provide mock.
 *
 * Supports Gmail (X-GM-RAW, labels) and generic IMAP (standard search, flags).
 */

import type { ImapSearchQuery } from "../core/search.js";
import type { Account } from "../domain/account.js";
import type { AppEffect, EmailLabel, MessageUid } from "../domain/types.js";

/** Raw attachment from email — pipeline applies eligibility, path resolution. */
export interface RawAttachment {
	readonly contentType: string;
	readonly filename: string | undefined;
	readonly size: number;
	/** In-memory data. When path is set (streamed to disk), empty — read from path when needed. */
	readonly data: Uint8Array;
	readonly messageUid: MessageUid;
	/** When set, attachment was streamed to this temp file. Use instead of data. */
	readonly path?: string;
}

/** Session-scoped email operations (connection already established). */
export interface EmailSession {
	readonly search: (query: ImapSearchQuery) => AppEffect<ReadonlyArray<MessageUid>>;
	readonly fetchAttachmentsForUids: (
		uids: readonly MessageUid[],
		maxSize: number,
	) => AppEffect<ReadonlyArray<RawAttachment>>;
	readonly markProcessed: (uids: readonly MessageUid[], value: EmailLabel) => AppEffect<void>;
}

export interface EmailClientService {
	/**
	 * Run operations within a pooled email connection. Connections are cached per
	 * account and reused across calls. Use Effect.retry on individual session
	 * calls for transient failures.
	 */
	readonly withConnection: <A, R>(
		account: Account,
		fn: (session: EmailSession) => AppEffect<A, R>,
	) => AppEffect<A, R>;
}
