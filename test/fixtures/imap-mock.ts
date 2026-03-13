import { Effect, Layer } from "effect";
import type { ImapSearchQuery } from "../../src/core/search.js";
import type { Account } from "../../src/domain/account.js";
import { ImapConnectionError } from "../../src/domain/errors.js";
import type { AppEffect, MessageUid } from "../../src/domain/types.js";
import { redactEmail, redactedForLog, unknownToMessage } from "../../src/domain/utils.js";
import type { EmailSession, RawAttachment } from "../../src/interfaces/email-client.js";
import { EmailClient } from "../../src/live/imap-email-client.js";

/** Static or callback-based responses. Callbacks override static values. */
export interface ImapMockScenario {
	searchResult?: readonly number[];
	searchCb?: (query: ImapSearchQuery) => readonly number[];
	attachments?: readonly RawAttachment[];
	attachmentsCb?: (uids: readonly number[]) => readonly RawAttachment[];
	/** When set, search() returns Effect.fail instead of succeed. */
	searchFail?: unknown;
	/** When set, fetchAttachmentsForUids() returns Effect.fail. */
	fetchFail?: unknown;
	/** When set, markProcessed() returns Effect.fail. */
	markProcessedFail?: unknown;
	/** When set, withConnection fails before fn(session) (connection-level auth failure). */
	connectFail?: unknown;
}

/** Captured calls for assertions. Mutated by the mock (test-only). */
export interface ImapMockSpy {
	searchCalls: ImapSearchQuery[];
	fetchCalls: { uids: number[]; maxSize: number }[];
	markProcessedCalls: { uids: number[]; value: string }[];
}

export function createImapMockLayer(
	scenario: ImapMockScenario,
	options?: { spy?: ImapMockSpy },
): Layer.Layer<EmailClient> {
	const spy = options?.spy;

	return Layer.mock(EmailClient)({
		withConnection: <A, R>(account: Account, fn: (session: EmailSession) => AppEffect<A, R>) => {
			const toDomainError = (cause: unknown) =>
				new ImapConnectionError({
					email: redactedForLog(account.email, redactEmail),
					message: unknownToMessage(cause),
				});
			if (scenario.connectFail !== undefined) {
				return Effect.fail(toDomainError(scenario.connectFail));
			}
			const session: EmailSession = {
				search: (query) => {
					if (spy) spy.searchCalls.push(query);
					if (scenario.searchFail !== undefined)
						return Effect.fail(toDomainError(scenario.searchFail));
					const uids = scenario.searchCb ? scenario.searchCb(query) : (scenario.searchResult ?? []);
					return Effect.succeed(uids as MessageUid[]);
				},
				fetchAttachmentsForUids: (uids, maxSize) => {
					if (spy) spy.fetchCalls.push({ uids: [...uids], maxSize });
					if (scenario.fetchFail !== undefined)
						return Effect.fail(toDomainError(scenario.fetchFail));
					const attachments = scenario.attachmentsCb
						? scenario.attachmentsCb(uids)
						: (scenario.attachments ?? []);
					return Effect.succeed(attachments);
				},
				markProcessed: (uids, value) => {
					if (spy) spy.markProcessedCalls.push({ uids: [...uids], value });
					if (scenario.markProcessedFail !== undefined)
						return Effect.fail(toDomainError(scenario.markProcessedFail));
					return Effect.void;
				},
			};
			return fn(session);
		},
	});
}
