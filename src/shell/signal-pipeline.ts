/**
 * Signal webhook pipeline — HTTP server (effect/unstable/http), attachment handling, account commands.
 *
 * Uses idiomatic HttpRouter.serve + NodeHttpServer.layer; Layer.launch as entry point.
 */

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
	Duration,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Redacted,
	Result,
	Schema,
} from "effect";
import * as Arr from "effect/Array";
import * as Http from "effect/unstable/http";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { fileTypeFromBuffer } from "file-type";
// Use "http" (not node:http) per project preference to avoid node: imports
// biome-ignore lint/style/useNodejsImportProtocol: intentional - Effect-native style
import { createServer } from "http";
import { isEligibleMime } from "../core/eligibility.js";
import {
	authorizeSource,
	buildSignalAttachmentBaseFilename,
	formatStatusMessage,
	parseAccountCommandInput,
	upsertAccount,
	validateAddGmailAccountInput,
} from "../core/index.js";
import { type Account, type AccountStatus, transitionAccount } from "../domain/account.js";
import {
	ConfigParseError,
	ConfigValidationError,
	type DomainError,
	formatErrorForStructuredLog,
} from "../domain/errors.js";
import {
	type AttachmentId,
	AttachmentIdSchema,
	decodeWebhookPayload,
	getDataMessage,
	getDataMessageBody,
	parseSignalAttachmentRef,
	resolveSignalSource,
	type SignalAttachmentRef,
	type SignalNumber,
	type SignalWebhookPayload,
} from "../domain/signal-types.js";
import type { AccountEmail, AppEffect, User, UserSlug } from "../domain/types.js";
import { AccountEmailSchema } from "../domain/types.js";
import {
	assertNever,
	redactedForLog,
	redactPath,
	redactUrl,
	unknownToMessage,
} from "../domain/utils.js";
import type { CredentialsStore } from "../live/credentials-store.js";
import { SignalClient } from "../live/signal-client.js";
import { SignalConfig, usersHint } from "./config.js";
import { mapFsError, resolveOutputPath } from "./fs-utils.js";
import { RateLimiterMemoryLayer, type SignalAppLayer } from "./layers.js";
import { loadAllAccounts, saveAllAccounts } from "./runtime.js";

export const MAX_ATTACHMENTS_PER_MESSAGE = 20;

/** Attachment ref with required id (output of collectValidAttachmentRefs). */
type ValidAttachmentRef = Omit<SignalAttachmentRef, "id"> & { id: AttachmentId };

/**
 * Extract valid attachment refs (have id) from webhook attachments array.
 * Skips malformed entries (null, array, non-object) and refs without id.
 * Pure function; exported for unit testing.
 */
export function collectValidAttachmentRefs(attachments: readonly unknown[]): ValidAttachmentRef[] {
	return Arr.filterMap(attachments, (attObj) => {
		if (typeof attObj !== "object" || attObj === null || Array.isArray(attObj))
			return Result.failVoid;
		const att = parseSignalAttachmentRef(attObj as Partial<SignalAttachmentRef>);
		if (!att.id) return Result.failVoid;
		const idOpt = Schema.decodeUnknownOption(AttachmentIdSchema)(att.id);
		return Option.match(idOpt, {
			onNone: () => Result.failVoid,
			onSome: (id) => Result.succeed({ ...att, id } as ValidAttachmentRef),
		});
	});
}

/** Trim attachments to max per message. Pure; exported for unit testing. */
export function trimAttachmentsToMax(attachments: readonly unknown[]): unknown[] {
	return attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
}

/** Resume ingestion reply status. */
type ResumeIngestionStatus = "not_found" | "removed" | "active";

/** Format add Gmail account reply. Pure; exported for unit testing. */
export function formatGmailAddReply(email: AccountEmail, isReactivation: boolean): string {
	return isReactivation
		? `✅ Re-activated ${email} with new credentials.\n\nYour inbox will be scanned automatically (label-based). All good — no action needed!`
		: `🎉 Added ${email}.\n\nYour inbox will be scanned automatically. Attachments (PDFs, images, Office docs, etc.) will be saved to Paperless. You're all set!`;
}

/** Format pause ingestion reply. Pure; exported for unit testing. */
export function formatPauseIngestionReply(email: AccountEmail, found: boolean): string {
	return found
		? `⏸️ Paused scanning for ${email}.\n\nTo resume: gmail resume ${email}`
		: `🤷 No account found for ${email}.\n\nCheck your accounts with: gmail status`;
}

/** Format remove account reply. Pure; exported for unit testing. */
export function formatRemoveAccountReply(email: AccountEmail, found: boolean): string {
	return found
		? `🗑️ Removed ${email}.\n\nTo re-add later: gmail add ${email} <app_password>`
		: `🤷 No account found for ${email}.\n\nCheck your accounts with: gmail status`;
}

/** Format resume ingestion reply. Pure; exported for unit testing. */
export function formatResumeIngestionReply(
	email: AccountEmail,
	status: ResumeIngestionStatus,
): string {
	switch (status) {
		case "not_found":
			return `🤷 No account found for ${email}.\n\nCheck your accounts with: gmail status`;
		case "removed":
			return `⚠️ ${email} was removed.\n\nRemoved accounts can't be resumed — you need to add it again with a fresh app password: gmail add ${email} <app_password>`;
		case "active":
			return `▶️ Resumed scanning for ${email}.\n\nYour inbox will be scanned automatically. Attachments saved to Paperless — no action needed!`;
		default:
			return assertNever(status);
	}
}

const HELP_MSG = `📚 Paperless Ingest Bot

Documents: Send any file as attachment here to save it to Paperless. PDFs, images, Office docs — all good.
Email: Scan your Gmail inbox. Attachments get saved automatically.

Gmail setup:
  gmail add user@example.com xxxx xxxx xxxx xxxx
  (App password: Google Account > Security > 2-Step Verification > App passwords)

Commands: gmail status | gmail pause <email> | gmail resume <email> | gmail remove <email>

Send a document to get started! 📄`;

/** Message when no eligible attachments were saved. Exported for unit testing. */
const FILE_TYPES_MSG =
	`📎 No documents saved from your attachments.\n\n` +
	`Those file types aren't supported — Paperless likes PDFs, images, Office docs, etc.\n\n` +
	`Valid types: PDF, images (JPEG, PNG, TIFF), Office (DOCX, XLSX, PPTX), RTF, text (plain, HTML, CSV).`;

/** Webhook handler for POST /webhook. Used by HttpRouter. */
const webhookHandler = Effect.fn("webhookHandler")(function* () {
	const limiter = yield* RateLimiter.RateLimiter;
	const rateLimitResult = yield* limiter
		.consume({
			key: "webhook",
			limit: WEBHOOK_RATE_LIMIT_PER_MINUTE,
			window: Duration.minutes(1),
			algorithm: "token-bucket",
			onExceeded: "fail",
		})
		.pipe(
			Effect.catchIf(
				(e): e is RateLimiter.RateLimiterError => e instanceof RateLimiter.RateLimiterError,
				() => Effect.succeed(null),
			),
		);
	if (rateLimitResult === null) {
		return Http.HttpServerResponse.jsonUnsafe({ error: "Too Many Requests" }, { status: 429 });
	}
	const req = yield* Http.HttpServerRequest.HttpServerRequest;
	const body = yield* req.json;
	const payload = decodeWebhookPayload(body);
	yield* Effect.forkChild(
		processWebhookPayload(payload).pipe(
			Effect.catch((e: unknown) =>
				Effect.logError({
					event: "webhook_error",
					error: formatErrorForStructuredLog(e),
				}),
			),
		),
	);
	return Http.HttpServerResponse.jsonUnsafe({ ok: true });
});

/** Validate consume_dir exists and is writable (writes temp file, then removes). Exported for testing. */
export const validateConsumeDir = Effect.fn("validateConsumeDir")(function* (consumeDir: string) {
	const fs = yield* FileSystem.FileSystem;
	const pathApi = yield* Path.Path;
	const exists = yield* fs.exists(consumeDir).pipe(mapFsError(consumeDir, "exists"));
	if (!exists) {
		yield* Effect.fail(
			new ConfigValidationError({
				message: "consume_dir does not exist",
				path: redactedForLog(consumeDir, redactPath),
				fix: `Create the directory: mkdir -p ${consumeDir}`,
			}),
		);
	}
	const probePath = pathApi.join(consumeDir, ".paperless-ingestion-bot-probe");
	yield* fs.writeFileString(probePath, "").pipe(mapFsError(consumeDir, "writeFileString"));
	yield* fs.remove(probePath).pipe(mapFsError(probePath, "remove"));
});

/** Validate signal_api_url is reachable (HEAD request). */
const validateSignalApiReachability = Effect.fn("validateSignalApiReachability")(function* (
	url: string,
) {
	const client = yield* HttpClient.HttpClient;
	const base = url.replace(/\/$/, "");
	const req = HttpClientRequest.head(`${base}/v1/accounts`);
	const res = yield* client.execute(req).pipe(
		Effect.mapError(
			(e) =>
				new ConfigValidationError({
					message: `signal_api_url not reachable: ${unknownToMessage(e)}`,
					path: redactedForLog(url, redactUrl),
					fix: "Ensure Signal REST API is running and reachable. Use --skip-reachability-check to bypass.",
				}),
		),
	);
	if (res.status >= 500) {
		yield* Effect.fail(
			new ConfigValidationError({
				message: `signal_api_url returned HTTP ${res.status}`,
				path: redactedForLog(url, redactUrl),
				fix: "Check Signal REST API health. Use --skip-reachability-check to bypass.",
			}),
		);
	}
});

/** Ensure consume dirs exist for all registry users. Exported for testing. */
const ensureUserConsumeDirs = Effect.fn("ensureUserConsumeDirs")(function* () {
	const config = yield* SignalConfig;
	const fs = yield* FileSystem.FileSystem;
	const pathApi = yield* Path.Path;
	return yield* Effect.forEach(
		config.registry.users,
		(user) => {
			const userDir = pathApi.join(config.consumeDir, user.consumeSubdir);
			return fs
				.makeDirectory(userDir, { recursive: true })
				.pipe(mapFsError(userDir, "makeDirectory"));
		},
		{ discard: true },
	);
});

const MAX_BODY_SIZE = FileSystem.Size(50 * 1024 * 1024);

/** Max webhook requests per minute (fixed window). Protects against runaway senders. */
const WEBHOOK_RATE_LIMIT_PER_MINUTE = 120;

/**
 * Options for buildSignalServerLayer. Public API for consumers.
 * @lintignore
 */
export interface SignalServerOptions {
	/** Skip startup validation of signal_api_url reachability. */
	readonly skipReachabilityCheck?: boolean;
}

export function buildSignalServerLayer(
	appLayer: SignalAppLayer,
	options?: SignalServerOptions,
): Layer.Layer<never, ConfigValidationError | Layer.Error<SignalAppLayer>, never> {
	const appWithMaxBody = appLayer.pipe(
		Layer.provideMerge(Layer.succeed(Http.HttpIncomingMessage.MaxBodySize)(MAX_BODY_SIZE)),
		Layer.provideMerge(RateLimiterMemoryLayer),
	);

	const webhookRoutes = Http.HttpRouter.use(
		Effect.fn("webhookRoutes")(function* (router) {
			yield* router.add("POST", "/webhook", webhookHandler);
		}),
	);

	const skipReachabilityCheck = options?.skipReachabilityCheck ?? false;
	const buildServerLayer = Effect.fn("buildSignalServerLayer")(function* () {
		const config = yield* SignalConfig;
		if (config.registry.users.length === 0) {
			yield* Effect.fail(
				new ConfigValidationError({
					message: "No users configured",
					path: redactedForLog(config.usersPath, redactPath),
					fix: usersHint(config.usersPath),
				}),
			);
		}
		yield* validateConsumeDir(config.consumeDir);
		if (!skipReachabilityCheck) {
			yield* validateSignalApiReachability(config.signalApiUrl);
		}
		yield* ensureUserConsumeDirs();

		const serverLayer = Http.HttpRouter.serve(webhookRoutes).pipe(
			Layer.provide(NodeHttpServer.layer(createServer, { port: config.port, host: config.host })),
			Layer.provide(appWithMaxBody),
		);
		return Http.HttpServer.withLogAddress(serverLayer);
	});

	return Layer.unwrap(buildServerLayer()).pipe(Layer.provide(appWithMaxBody)) as Layer.Layer<
		never,
		ConfigValidationError | Layer.Error<SignalAppLayer>,
		never
	>;
}

const UNAUTHORIZED_MSG = `🚫 Not authorized.\n\nYour number isn't in the allowed list. Contact the admin to get access.`;

/** Resolve authorized user from source; on failure logs and replies. Exported for testing. */
const resolveAuthorizedUser = Effect.fn("resolveAuthorizedUser")(function* (
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	const config = yield* SignalConfig;
	const authResult = authorizeSource(config.registry, source);
	return yield* Effect.fromResult(authResult).pipe(
		Effect.tapError(() =>
			Effect.fn("resolveAuthorizedUser.onError")(function* () {
				yield* Effect.logWarning({ event: "unauthorized_source", source });
				yield* reply(source, UNAUTHORIZED_MSG);
			})(),
		),
	);
});

/** Process webhook payload (exported for testing). */
export function processWebhookPayload(data: SignalWebhookPayload) {
	return Effect.fn("processWebhookPayload")(function* () {
		const config = yield* SignalConfig;
		const dataMessageOpt = getDataMessage(data);
		const dataMessage = Option.getOrUndefined(dataMessageOpt);
		if (!dataMessage) {
			yield* Effect.log({
				event: "webhook_received",
				status: "skipped",
				reason: "no_data_message",
			});
			return;
		}

		const attachments = Array.isArray(dataMessage.attachments) ? dataMessage.attachments : [];
		const body = getDataMessageBody(dataMessage);
		const sourceOpt = resolveSignalSource(data);
		const source = Option.getOrUndefined(sourceOpt);
		if (!source) {
			yield* Effect.log({ event: "webhook_received", status: "skipped", reason: "no_source" });
			return;
		}

		const user = yield* resolveAuthorizedUser(source, data);

		const trimmedAttachments = trimAttachmentsToMax(attachments);

		if (trimmedAttachments.length === 0) {
			return yield* processWebhookTextCommand(body, source, data, user);
		}

		return yield* processWebhookAttachments(
			trimmedAttachments,
			`${config.consumeDir}/${user.consumeSubdir}`,
			source,
			data,
		);
	})();
}

/** Process text-only webhook (no attachments): handle command, optionally send help. */
function processWebhookTextCommand(
	body: string,
	source: SignalNumber,
	_data: SignalWebhookPayload,
	user: User,
) {
	return Effect.fn("processWebhookTextCommand")(function* () {
		const handled = yield* handleTextCommand(body, source, _data, user);
		if (handled) {
			yield* Effect.log({
				event: "webhook_received",
				status: "succeeded",
				source,
				handled: "text_command",
			});
		}
		yield* Effect.when(reply(source, HELP_MSG), Effect.succeed(!handled));
	})();
}

/** Process webhook attachments: save to consume dir, log, optionally reply with file types. */
function processWebhookAttachments(
	attachments: unknown[],
	userConsumeDir: string,
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	return Effect.fn("processWebhookAttachments")(function* () {
		const validRefs = collectValidAttachmentRefs(attachments);
		const saveResults = yield* Effect.forEach(validRefs, (att) =>
			saveAttachmentToConsume(att.id, att.customFilename, att.contentType, userConsumeDir),
		);
		const saved = Arr.filter(saveResults, (b): b is true => b).length;

		yield* Effect.log({
			event: "webhook_received",
			status: "succeeded",
			source,
			attachments_saved: saved,
			attachments_total: attachments.length,
		});
		yield* Effect.when(reply(source, FILE_TYPES_MSG), Effect.succeed(saved === 0));
	})();
}

function reply(source: SignalNumber, message: string) {
	return Effect.fn("reply")(
		function* () {
			const signalClient = yield* SignalClient;
			const accountOpt = yield* signalClient.getAccount();
			yield* Option.match(accountOpt, {
				onNone: () => Effect.logWarning({ event: "reply_skipped", reason: "no_account" }),
				onSome: (account) =>
					signalClient.sendMessage(account, source, message).pipe(
						Effect.tapError((e) =>
							Effect.logError({
								event: "reply_failed",
								source,
								error: formatErrorForStructuredLog(e),
							}),
						),
					),
			});
		},
		Effect.mapError((e) =>
			e instanceof Error && "_tag" in e
				? (e as DomainError)
				: new ConfigValidationError({ message: String(e) }),
		),
	)();
}

/** Detect MIME from buffer, check eligibility. Returns { eligible: true } or { eligible: false }. */
function detectMimeAndCheckEligibility(
	data: Uint8Array,
	contentType: string | undefined,
): Effect.Effect<
	| { eligible: true; mime: string; fileType: Awaited<ReturnType<typeof fileTypeFromBuffer>> }
	| { eligible: false },
	ConfigValidationError,
	never
> {
	return Effect.fn("detectMimeAndCheckEligibility")(function* () {
		const fileType = yield* Effect.tryPromise({
			try: () => fileTypeFromBuffer(data),
			catch: (e) =>
				new ConfigValidationError({
					message: `File type detection failed: ${unknownToMessage(e)}`,
				}),
		});
		const mime = fileType?.mime ?? contentType ?? "application/octet-stream";
		const elig = isEligibleMime(mime);
		if (Result.isFailure(elig)) return { eligible: false } as const;
		return { eligible: true, mime, fileType };
	})();
}

/** Write eligible attachment to consume dir. */
function writeEligibleAttachmentToFs(
	consumeDir: string,
	attachmentId: string,
	customFilename: string | undefined,
	contentType: string | undefined,
	fileType: Awaited<ReturnType<typeof fileTypeFromBuffer>>,
	data: Uint8Array,
) {
	return Effect.fn("writeEligibleAttachmentToFs")(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs
			.makeDirectory(consumeDir, { recursive: true })
			.pipe(mapFsError(consumeDir, "makeDirectory"));
		const baseFilename = buildSignalAttachmentBaseFilename(
			attachmentId,
			customFilename,
			contentType,
			fileType,
		);
		const outPath = yield* resolveOutputPath(consumeDir, baseFilename);
		yield* fs.writeFile(outPath, data).pipe(mapFsError(outPath, "writeFile"));
	})();
}

function saveAttachmentToConsume(
	attachmentId: AttachmentId,
	customFilename: string | undefined,
	contentType: string | undefined,
	consumeDir: string,
) {
	return Effect.fn("saveAttachmentToConsume")(
		function* () {
			const signalClient = yield* SignalClient;

			const data = yield* signalClient.fetchAttachment(attachmentId);
			if (data.length === 0) return false;

			const detection = yield* detectMimeAndCheckEligibility(new Uint8Array(data), contentType);
			if (!detection.eligible) return false;

			yield* writeEligibleAttachmentToFs(
				consumeDir,
				attachmentId,
				customFilename,
				contentType,
				detection.fileType,
				data,
			);
			return true;
		},
		Effect.mapError((e) =>
			e instanceof Error && "_tag" in e
				? (e as DomainError)
				: new ConfigValidationError({ message: String(e) }),
		),
	)();
}

function handleTextCommand(
	body: string,
	source: SignalNumber,
	_data: SignalWebhookPayload,
	user: User,
) {
	return Option.match(parseAccountCommandInput(body), {
		onNone: () => Effect.succeed(false),
		onSome: (cmd) => {
			switch (cmd._tag) {
				case "AddGmailAccountCommand":
					return handleAddGmailAccount(cmd.rawEmail, cmd.rawPassword, source, _data, user);
				case "StatusIngestionCommand":
					return handleIngestionStatus(source, _data);
				case "PauseIngestionCommand":
					return handlePauseIngestion(cmd.email, source, _data);
				case "ResumeIngestionCommand":
					return handleResumeIngestion(cmd.email, source, _data);
				case "RemoveAccountCommand":
					return handleRemoveAccount(cmd.email, source, _data);
				default:
					return assertNever(cmd);
			}
		},
	});
}

/** Validate, upsert account, persist to email-accounts.json (user-generated data). Returns isReactivation. Exported for testing. */
const validateAndUpsertAccount = Effect.fn("validateAndUpsertAccount")(function* (
	validatedEmailRaw: string,
	validatedPwRaw: string,
	userSlug: UserSlug,
	emailAddrForReactivation: string,
) {
	const config = yield* SignalConfig;
	const validatedEmail = yield* Schema.decodeUnknownEffect(AccountEmailSchema)(
		validatedEmailRaw,
	).pipe(
		Effect.mapError(
			(e) =>
				new ConfigParseError({
					path: redactedForLog(config.emailAccountsPath, redactPath),
					message: `Invalid email after validation: ${unknownToMessage(e)}`,
				}),
		),
	);
	const validatedPw = Redacted.make(validatedPwRaw);
	const accounts = yield* loadAllAccounts(config.emailAccountsPath, config.markProcessedLabel);
	const updated = upsertAccount(
		accounts,
		validatedEmail,
		validatedPw,
		userSlug,
		config.markProcessedLabel,
	);
	yield* saveAllAccounts(config.emailAccountsPath, updated);
	return accounts.some((a) => a.email === emailAddrForReactivation);
});

/** Handle `gmail add` — writes user-generated data to email-accounts.json. */
function handleAddGmailAccount(
	emailAddr: string,
	appPassword: string,
	source: SignalNumber,
	_data: SignalWebhookPayload,
	user: User,
) {
	return Effect.fn("handleAddGmailAccount")(function* () {
		const validationResult = validateAddGmailAccountInput(emailAddr, appPassword);
		if (Result.isFailure(validationResult)) {
			yield* reply(source, validationResult.failure);
			return true;
		}
		const { email: validatedEmailRaw, password: validatedPwRaw } = validationResult.success;
		const validatedEmail = Schema.decodeSync(AccountEmailSchema)(validatedEmailRaw);
		const isReactivation = yield* validateAndUpsertAccount(
			validatedEmailRaw,
			validatedPwRaw,
			user.slug,
			emailAddr,
		);
		yield* reply(source, formatGmailAddReply(validatedEmail, isReactivation));
		yield* Effect.log({
			event: "gmail_add",
			status: "succeeded",
			email: emailAddr,
			user: user.displayName,
		});
		return true;
	})();
}

function updateAccountStatus(
	emailAccountsPath: string,
	targetEmail: AccountEmail,
	status: AccountStatus,
): AppEffect<boolean, FileSystem.FileSystem | Path.Path | CredentialsStore> {
	return Effect.fn("updateAccountStatus")(function* () {
		const accounts = yield* loadAllAccounts(emailAccountsPath, "paperless");
		const found = Option.fromUndefinedOr(
			Arr.findFirstWithIndex(accounts, (a) => a.email === targetEmail),
		);
		return yield* Option.match(found, {
			onNone: () => Effect.succeed(false),
			onSome: ([acc, idx]) =>
				Effect.fn("updateAccountStatus.inner")(function* () {
					const updated = accounts.with(idx, transitionAccount(acc, status));
					yield* saveAllAccounts(emailAccountsPath, updated);
					return true;
				})(),
		});
	})();
}

function handlePauseIngestion(
	email: AccountEmail,
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	return Effect.fn("handlePauseIngestion")(function* () {
		const config = yield* SignalConfig;
		const ok = yield* updateAccountStatus(config.emailAccountsPath, email, "paused");
		yield* reply(source, formatPauseIngestionReply(email, ok));
		return true;
	})();
}

/** Handle resume when account not found. Exported for testing. */
function handleResumeNotFound(
	email: AccountEmail,
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	return reply(source, formatResumeIngestionReply(email, "not_found")).pipe(Effect.as(true));
}

/** Handle resume when account found (removed vs active). Exported for testing. */
function handleResumeFound(
	acc: Account,
	email: AccountEmail,
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	if (acc._tag === "removed") {
		return reply(source, formatResumeIngestionReply(email, "removed")).pipe(Effect.as(true));
	}
	return Effect.fn("handleResumeFound.active")(function* () {
		const config = yield* SignalConfig;
		const ok = yield* updateAccountStatus(config.emailAccountsPath, email, "active");
		yield* Effect.when(
			reply(source, formatResumeIngestionReply(email, "active")),
			Effect.succeed(ok),
		);
		return true;
	})();
}

function handleResumeIngestion(
	email: AccountEmail,
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	return Effect.fn("handleResumeIngestion")(function* () {
		const config = yield* SignalConfig;
		const accounts = yield* loadAllAccounts(config.emailAccountsPath, config.markProcessedLabel);
		const accOpt = Arr.findFirst(accounts, (a) => a.email === email);
		return yield* Option.match(accOpt, {
			onNone: () => handleResumeNotFound(email, source, _data),
			onSome: (acc) => handleResumeFound(acc, email, source, _data),
		});
	})();
}

function handleRemoveAccount(
	email: AccountEmail,
	source: SignalNumber,
	_data: SignalWebhookPayload,
) {
	return Effect.fn("handleRemoveAccount")(function* () {
		const config = yield* SignalConfig;
		const ok = yield* updateAccountStatus(config.emailAccountsPath, email, "removed");
		yield* reply(source, formatRemoveAccountReply(email, ok));
		return true;
	})();
}

function handleIngestionStatus(source: SignalNumber, _data: SignalWebhookPayload) {
	return Effect.fn("handleIngestionStatus")(function* () {
		const config = yield* SignalConfig;
		const accounts = yield* loadAllAccounts(config.emailAccountsPath, config.markProcessedLabel);
		const message = formatStatusMessage(accounts);
		yield* reply(source, message);
		return true;
	})();
}
