/**
 * Email pipeline — Gmail IMAP crawl, attachment extraction, AI assessment.
 *
 * Label-based crawl: search -label:paperless, paginate, process. If no eligible
 * attachments on a page, try next page immediately. Uses Effect.retry for IMAP.
 * Document assessment via Ollama (OllamaClient.assess).
 */

import { Duration, Effect, Schedule } from "effect";
import * as Arr from "effect/Array";
import { sumAll } from "effect/Number";
import { buildSearch, emailToSlug, mergeExcludeLabels } from "../core/index.js";
import { type Account, isActiveAccount } from "../domain/account.js";
import type { MessageUid } from "../domain/types.js";
import type { EmailSession } from "../interfaces/email-client.js";
import { EmailClient } from "../live/imap-email-client.js";
import { EmailConfig } from "./config.js";
import { onProcessAccountError } from "./credential-failure.js";
import {
	collectEligibleAttachments,
	fetchAttachmentsWithRetry,
	fetchUidsWithRetry,
	saveEligibleAttachments,
} from "./email-attachments.js";
import { loadAllAccounts } from "./runtime.js";

/** Re-export for tests. */
export {
	type AttachmentToSave,
	MAX_ATTACHMENT_SIZE,
	saveEligibleAttachments,
} from "./email-attachments.js";

const imapRetrySchedule = Schedule.exponential("1 second", 2).pipe(
	Schedule.compose(Schedule.recurs(2)),
);

/** Fast retry schedule for tests (~10ms total). Use via config.imapRetrySchedule. */
export const imapRetryScheduleFast = Schedule.exponential(Duration.millis(1), 2).pipe(
	Schedule.compose(Schedule.recurs(2)),
);

/** Process single account with IMAP session. */
const processAccountWithImap = Effect.fn("processAccountWithImap")(function* (
	acc: Account,
	session: EmailSession,
) {
	const config = yield* EmailConfig;

	yield* Effect.log({
		event: "email_pipeline_account",
		status: "started",
		email: acc.email,
	});

	const excludeLabels = mergeExcludeLabels(
		[...acc.imapConfig.defaultExcludeLabels],
		acc.excludeLabels,
		config.markProcessedLabel,
	);
	const searchQuery = buildSearch(acc.imapConfig, excludeLabels);
	const retrySchedule = config.imapRetrySchedule ?? imapRetrySchedule;

	const uids = yield* fetchUidsWithRetry(session, searchQuery, acc, retrySchedule);

	const saved = yield* processAccountPages(acc, session, uids);

	yield* Effect.log({
		event: "email_pipeline_account",
		status: "succeeded",
		email: acc.email,
		uids: uids.length,
		saved,
	});
	return saved;
});

export const runEmailPipeline = Effect.fn("runEmailPipeline")(function* () {
	yield* Effect.log({ event: "email_pipeline", status: "started" });

	const config = yield* EmailConfig;
	const imap = yield* EmailClient;

	const accounts = yield* loadAllAccounts(config.emailAccountsPath, config.markProcessedLabel);
	const activeAccounts = Arr.filter(accounts, isActiveAccount);
	const activeCount = activeAccounts.length;
	yield* Effect.log({
		event: "email_pipeline",
		status: "accounts_loaded",
		total: accounts.length,
		active: activeCount,
	});

	const processAccount = (acc: Account) =>
		imap
			.withConnection(acc, (session) => processAccountWithImap(acc, session))
			.pipe(Effect.tapError(onProcessAccountError(acc)));

	const savedCounts = yield* Effect.forEach(activeAccounts, processAccount);
	const totalSaved = sumAll(savedCounts);

	yield* Effect.log({ event: "email_pipeline", status: "succeeded", saved: totalSaved });
	return { saved: totalSaved };
});

const processAccountPages = Effect.fn("processAccountPages")(function* (
	acc: Account,
	session: EmailSession,
	uids: readonly MessageUid[],
) {
	const config = yield* EmailConfig;
	const emailSlug = emailToSlug(acc.email);

	const pages = Arr.chunksOf(uids, config.pageSize);
	for (const pageUids of pages) {
		const result = yield* processPage(acc, session, emailSlug, pageUids);
		if (result.saved > 0) {
			const value = config.markProcessedLabel;
			if (value && result.labeledUids.length > 0) {
				yield* session.markProcessed(result.labeledUids, value);
			}
			return result.saved;
		}
	}
	return 0;
});

const processPage = Effect.fn("processPage")(function* (
	acc: Account,
	session: EmailSession,
	emailSlug: string,
	pageUids: readonly MessageUid[],
) {
	const config = yield* EmailConfig;
	const retrySchedule = config.imapRetrySchedule ?? imapRetrySchedule;

	const rawAttachments = yield* fetchAttachmentsWithRetry(session, pageUids, acc, retrySchedule);

	const toSave = yield* collectEligibleAttachments(rawAttachments, emailSlug);
	if (toSave.length === 0) return { saved: 0, labeledUids: [] };

	return yield* saveEligibleAttachments(toSave);
});
