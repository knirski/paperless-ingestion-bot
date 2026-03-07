import { Temporal } from "@js-temporal/polyfill";
import { Option, Redacted, Result, Schema } from "effect";
import * as FastCheck from "effect/testing/FastCheck";
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
	attachmentBaseFilename,
	authorizeSource,
	buildOllamaRequest,
	buildSearch,
	buildSignalAttachmentBaseFilename,
	collisionCandidateFilename,
	emailToSlug,
	formatCredentialFailureMessage,
	formatStatusMessage,
	isAuthFailure,
	isEligibleMime,
	isEmailAttachmentEligible,
	MIN_EMAIL_IMAGE_SIZE,
	mergeExcludeLabels,
	parseAccountCommandInput,
	parseOllamaYesNo,
	safeFilename,
	shouldNotify,
	splitFilenameForCollision,
	upsertAccount,
	validateAddGmailAccountInput,
	validateAppPassword,
	validateEmail,
} from "../src/core/index.js";
import { type Account, AccountMetadataSchema, transitionAccount } from "../src/domain/account.js";
import {
	AppPasswordTooShortError,
	AttachmentTooLargeError,
	ConfigParseError,
	ConfigValidationError,
	FileSystemError,
	formatDomainError,
	ImapConnectionError,
	IneligibleAttachmentError,
	InvalidEmailError,
	KeyringError,
	OllamaRequestError,
	PayloadTooLargeError,
	SignalApiHttpError,
	UnauthorizedUserError,
	wrapFs,
} from "../src/domain/errors.js";
import {
	GMAIL_PRESET,
	type ImapProviderConfig,
	resolveImapConfig,
} from "../src/domain/imap-provider.js";
import { extensionFromContentType } from "../src/domain/mime.js";
import type { SignalNumber } from "../src/domain/signal-types.js";
import {
	decodeWebhookPayload,
	getDataMessage,
	getDataMessageBody,
	getEnvelope,
	parseSignalAttachmentRef,
	resolveSignalSource,
} from "../src/domain/signal-types.js";
import {
	type AccountEmail,
	AccountEmailSchema,
	type ConsumeSubdir,
	createUserRegistry,
	type EmailLabel,
	type UserSlug,
} from "../src/domain/types.js";
import {
	redactEmail,
	redactedForLog,
	redactPath,
	redactPhone,
	redactUrl,
} from "../src/domain/utils.js";

const baseAccount: Account = {
	email: "a@example.com" as AccountEmail,
	appPassword: Redacted.make("x"),
	_tag: "active",
	excludeLabels: [] as EmailLabel[],
	imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
	addedBy: "user1" as UserSlug,
};

describe("core", () => {
	describe("file helpers", () => {
		test.each([
			{ input: "application/pdf", expected: ".pdf" },
			{ input: "image/jpeg", expected: ".jpg" },
			{ input: "image/png", expected: ".png" },
			{ input: "image/unknown", expected: "" },
			{ input: undefined, expected: "" },
		])("extensionFromContentType($input) -> $expected", ({ input, expected }) => {
			expect(extensionFromContentType(input)).toBe(expected);
		});

		test.each([
			{ input: "normal.pdf", expected: "normal.pdf" },
			{ input: 'file<>:"/\\|?*.pdf', expected: "file_________.pdf" },
		])("safeFilename($input) -> $expected", ({ input, expected }) => {
			expect(safeFilename(input)).toBe(expected);
		});

		test.each([
			{
				id: "abc",
				custom: undefined,
				ct: "application/pdf",
				ft: undefined,
				expected: "signal_abc.pdf",
			},
			{ id: "x", custom: "my-file", ct: "image/png", ft: undefined, expected: "my-file.png" },
			{ id: "x", custom: "doc", ct: undefined, ft: { ext: "pdf" }, expected: "doc.pdf" },
		])("buildSignalAttachmentBaseFilename($id, $custom, $ct, $ft) -> $expected", ({
			id,
			custom,
			ct,
			ft,
			expected,
		}) => {
			expect(buildSignalAttachmentBaseFilename(id, custom, ct, ft)).toBe(expected);
		});

		test("safeFilename truncates to maxLen", () => {
			expect(safeFilename("a".repeat(300))).toHaveLength(200);
		});

		test("safeFilename: never contains invalid chars (PBT)", () => {
			fc.assert(
				fc.property(fc.string({ maxLength: 500 }), (name) => {
					const result = safeFilename(name);
					const invalid = /[<>:"/\\|?*]/;
					expect(invalid.test(result)).toBe(false);
					expect(result.length).toBeLessThanOrEqual(200);
					expect(result.length).toBeGreaterThan(0);
				}),
			);
		});
	});

	describe("MIME / eligibility", () => {
		test.each([
			{ mime: "application/pdf", expected: true },
			{ mime: "image/jpeg", expected: true },
			{ mime: "application/octet-stream", expected: false },
		])("isEligibleMime($mime) -> $expected", ({ mime, expected }) => {
			expect(Result.isSuccess(isEligibleMime(mime))).toBe(expected);
		});

		test("isEmailAttachmentEligible", () => {
			expect(Result.isSuccess(isEmailAttachmentEligible("application/pdf", "doc.pdf", 1000))).toBe(
				true,
			);
			expect(Result.isSuccess(isEmailAttachmentEligible("image/jpeg", "x.jpg", 50))).toBe(false);
			expect(Result.isSuccess(isEmailAttachmentEligible(undefined, "x.pdf", 1000))).toBe(false);
			expect(Result.isSuccess(isEmailAttachmentEligible("text/calendar", "x.ics", 1000))).toBe(
				false,
			);
			expect(
				Result.isSuccess(
					isEmailAttachmentEligible("image/jpeg", "logo.png", MIN_EMAIL_IMAGE_SIZE + 1),
				),
			).toBe(false);
			expect(
				Result.isSuccess(isEmailAttachmentEligible("application/octet-stream", "x.bin", 1000)),
			).toBe(false);
		});
	});

	describe("validation", () => {
		test.each([
			{ email: "user@example.com", expected: true },
			{ email: "invalid", expected: false },
			{ email: "a@example.com", expected: true },
			{ email: "", expected: false },
		])("validateEmail($email) -> $expected", ({ email, expected }) => {
			expect(Result.isSuccess(validateEmail(email))).toBe(expected);
		});

		test("validateEmail: valid format always succeeds (PBT)", () => {
			const validEmail = fc.stringMatching(/^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/);
			fc.assert(
				fc.property(validEmail, (email) => {
					expect(Result.isSuccess(validateEmail(email))).toBe(true);
				}),
			);
		});

		test.each([
			{ pw: "a".repeat(16), expected: true },
			{ pw: "short", expected: false },
		])("validateAppPassword($pw) -> $expected", ({ pw, expected }) => {
			expect(Result.isSuccess(validateAppPassword(pw))).toBe(expected);
		});

		test("validateAppPassword: 16+ non-whitespace chars succeeds (PBT)", () => {
			const pwArb = fc.stringMatching(/\S{16,100}/);
			fc.assert(
				fc.property(pwArb, (pw: string) => {
					expect(Result.isSuccess(validateAppPassword(pw))).toBe(true);
				}),
			);
		});

		test.each([
			{ email: "user@example.com", pw: "a".repeat(16), expected: true },
			{ email: "invalid", pw: "a".repeat(16), expected: false },
			{ email: "a@example.com", pw: "short", expected: false },
		])("validateAddGmailAccountInput($email, $pw) -> $expected", ({ email, pw, expected }) => {
			expect(Result.isSuccess(validateAddGmailAccountInput(email, pw))).toBe(expected);
		});

		test("validateAddGmailAccountInput: failure returns user-facing message", () => {
			const r = validateAddGmailAccountInput("bad", "x");
			expect(Result.isFailure(r)).toBe(true);
			if (Result.isFailure(r)) expect(r.failure).toContain("Invalid email");
		});
	});

	describe("Account commands", () => {
		test("parseAccountCommandInput", () => {
			expect(
				Option.getOrUndefined(parseAccountCommandInput("gmail add user@example.com pass123")),
			).toMatchObject({
				_tag: "AddGmailAccountCommand",
				rawEmail: "user@example.com",
			});
			expect(Option.getOrUndefined(parseAccountCommandInput("gmail status"))).toMatchObject({
				_tag: "StatusIngestionCommand",
			});
			expect(
				Option.getOrUndefined(parseAccountCommandInput("gmail pause user@example.com")),
			).toMatchObject({
				_tag: "PauseIngestionCommand",
				email: "user@example.com",
			});
			expect(
				Option.getOrUndefined(parseAccountCommandInput("gmail resume user@example.com")),
			).toMatchObject({
				_tag: "ResumeIngestionCommand",
				email: "user@example.com",
			});
			expect(
				Option.getOrUndefined(parseAccountCommandInput("gmail remove user@example.com")),
			).toMatchObject({
				_tag: "RemoveAccountCommand",
				email: "user@example.com",
			});
			expect(Option.isNone(parseAccountCommandInput("hello"))).toBe(true);
			expect(Option.isNone(parseAccountCommandInput("gmail pause"))).toBe(true);
			expect(Option.isNone(parseAccountCommandInput("gmail resume"))).toBe(true);
			expect(Option.isNone(parseAccountCommandInput("gmail pause invalid-email"))).toBe(true);
		});
	});

	describe("date / crawl", () => {
		test.each([
			{
				defaults: ["category:promotions", "SPAM"] as const,
				account: ["Archived", "Newsletters"] as const,
				processed: "paperless" as const,
				expected: ["category:promotions", "SPAM", "Archived", "Newsletters", "paperless"],
			},
			{
				defaults: ["SPAM"],
				account: ["SPAM"],
				processed: "paperless" as EmailLabel,
				expected: ["SPAM", "paperless"],
			},
			{ defaults: ["SPAM"], account: [], processed: "", expected: ["SPAM"] },
			{ defaults: [], account: [], processed: "", expected: [] },
			{ defaults: ["a"], account: [], processed: "x", expected: ["a", "x"] },
		])("mergeExcludeLabels($defaults, $account, $processed) -> $expected", ({
			defaults,
			account,
			processed,
			expected,
		}) => {
			expect(
				mergeExcludeLabels(
					defaults as EmailLabel[],
					account as EmailLabel[],
					processed as EmailLabel,
				),
			).toEqual(expected);
		});

		test("mergeExcludeLabels: output is deduplicated (PBT)", () => {
			fc.assert(
				fc.property(
					fc.array(fc.string({ maxLength: 20 }), { maxLength: 10 }),
					fc.array(fc.string({ maxLength: 20 }), { maxLength: 10 }),
					fc.string({ maxLength: 20 }),
					(defaults, account, processed) => {
						const result = mergeExcludeLabels(
							defaults as EmailLabel[],
							account as EmailLabel[],
							processed as EmailLabel,
						);
						const unique = [...new Set(result)];
						expect(result).toEqual(unique);
					},
				),
			);
		});

		test("buildSearch: gmail empty yields all, labels yield gmraw", () => {
			const gmailConfig: ImapProviderConfig = {
				...GMAIL_PRESET,
				markProcessedLabel: "paperless" as EmailLabel,
			};
			const emptyQuery = buildSearch(gmailConfig, []);
			expect("gmraw" in emptyQuery && emptyQuery.gmraw).toBeTruthy();
			expect(emptyQuery).toMatchObject({ gmraw: "all" });

			const labelQuery = buildSearch(gmailConfig, [
				"category:promotions" as EmailLabel,
				"SPAM" as EmailLabel,
			]);
			const labelGmraw = "gmraw" in labelQuery ? labelQuery.gmraw : "";
			expect(labelGmraw).toContain("-category:promotions");
			expect(labelGmraw).toContain("-label:SPAM");
		});

		test("buildSearch: gmail returns gmraw, generic returns all", () => {
			const gmailConfig: ImapProviderConfig = {
				...GMAIL_PRESET,
				markProcessedLabel: "paperless" as EmailLabel,
			};
			const gmailQuery = buildSearch(gmailConfig, ["SPAM" as EmailLabel]);
			expect("gmraw" in gmailQuery && gmailQuery.gmraw).toBeTruthy();
			expect(gmailQuery).toMatchObject({ gmraw: expect.stringContaining("-label:SPAM") });

			const genericConfig = resolveImapConfig("generic", "paperless" as EmailLabel);
			const genericQuery = buildSearch(genericConfig, []);
			expect(genericQuery).toEqual({ all: true });
		});

		test("AccountMetadataSchema: Schema.toArbitrary generates decodable values (PBT)", () => {
			const arb = Schema.toArbitrary(AccountMetadataSchema);
			FastCheck.assert(
				FastCheck.property(arb, (entry) => {
					const encoded = Schema.encodeSync(AccountMetadataSchema)(entry);
					const decoded = Schema.decodeUnknownSync(AccountMetadataSchema)(encoded);
					expect(decoded).toEqual(entry);
				}),
				{ numRuns: 100 },
			);
		});

		test("buildSearch: gmail empty yields all, each label yields -label or -category (PBT)", () => {
			const gmailConfig: ImapProviderConfig = {
				...GMAIL_PRESET,
				markProcessedLabel: "paperless" as EmailLabel,
			};
			const labelArb = fc.constantFrom(
				"category:promotions",
				"category:social",
				"SPAM",
				"TRASH",
				"Archived",
				"Inbox",
			);
			fc.assert(
				fc.property(fc.array(labelArb, { maxLength: 20 }), (labels) => {
					const q = buildSearch(gmailConfig, labels as EmailLabel[]);
					expect("gmraw" in q).toBe(true);
					const gmraw = "gmraw" in q ? q.gmraw : "";
					if (labels.length === 0) expect(gmraw).toBe("all");
					else {
						for (const label of labels) {
							if (label.startsWith("category:")) {
								expect(gmraw).toContain(`-category:${label.slice(9)}`);
							} else {
								expect(gmraw).toContain(`-label:${label}`);
							}
						}
					}
				}),
			);
		});

		test.each([
			{ email: "user@example.com", expected: "user-example-com" },
			{ email: "A@EXAMPLE.COM", expected: "a-example-com" },
		])("emailToSlug($email) -> $expected", ({ email, expected }) => {
			expect(emailToSlug(email)).toBe(expected);
		});

		test("emailToSlug: output has no @ or . (PBT)", () => {
			fc.assert(
				fc.property(fc.emailAddress(), (email) => {
					const slug = emailToSlug(email);
					expect(slug).not.toContain("@");
					expect(slug).not.toContain(".");
					expect(slug).toBe(slug.toLowerCase());
				}),
			);
		});

		test.each([
			{ input: "doc.pdf", expected: { stem: "doc", suffix: ".pdf" } },
			{ input: "file.name.docx", expected: { stem: "file.name", suffix: ".docx" } },
			{ input: "noext", expected: { stem: "noext", suffix: "" } },
			{ input: ".hidden", expected: { stem: "", suffix: ".hidden" } },
			{ input: "a.b.c", expected: { stem: "a.b", suffix: ".c" } },
		])("splitFilenameForCollision($input) -> $expected", ({ input, expected }) => {
			expect(splitFilenameForCollision(input)).toEqual(expected);
		});

		test("splitFilenameForCollision: stem + suffix restores original when name.ext (PBT)", () => {
			const nameExt = fc
				.string({ minLength: 1, maxLength: 50 })
				.filter((s) => !s.includes(".") && !s.includes("/") && !s.includes("\\"))
				.chain((name) =>
					fc
						.string({ minLength: 1, maxLength: 10 })
						.filter((s) => !s.includes(".") && !s.includes("/") && !s.includes("\\"))
						.map((ext) => `${name}.${ext}`),
				);
			fc.assert(
				fc.property(nameExt, (filename) => {
					const { stem, suffix } = splitFilenameForCollision(filename);
					expect(stem + suffix).toBe(filename);
					expect(suffix.startsWith(".")).toBe(true);
				}),
			);
		});

		test.each([
			{ stem: "doc", suffix: ".pdf", idx: 1, expected: "doc_1.pdf" },
			{ stem: "file", suffix: "", idx: 2, expected: "file_2" },
			{ stem: "a", suffix: ".x", idx: 0, expected: "a_0.x" },
		])("collisionCandidateFilename($stem, $suffix, $idx) -> $expected", ({
			stem,
			suffix,
			idx,
			expected,
		}) => {
			expect(collisionCandidateFilename(stem, suffix, idx)).toBe(expected);
		});

		test("collisionCandidateFilename: output format stem_idx suffix (PBT)", () => {
			fc.assert(
				fc.property(
					fc.string({ maxLength: 50 }),
					fc.string({ maxLength: 20 }),
					fc.nat(1000),
					(stem, suffix, idx) => {
						const result = collisionCandidateFilename(stem, suffix, idx);
						expect(result).toBe(`${stem}_${idx}${suffix}`);
					},
				),
			);
		});

		test.each([
			{
				filename: "invoice.pdf",
				contentType: "application/pdf",
				fallback: 0,
				expected: "invoice.pdf",
			},
			{ filename: "data", contentType: "text/csv", fallback: 0, expected: "data.csv" },
			{ filename: undefined, contentType: "image/png", fallback: 3, expected: "attachment_3.png" },
			{ filename: "doc", contentType: undefined, fallback: 1, expected: "doc" },
			{ filename: "x.pdf", contentType: "image/jpeg", fallback: 0, expected: "x.jpg" },
		])("attachmentBaseFilename($filename, $contentType, $fallback) -> $expected", ({
			filename,
			contentType,
			fallback,
			expected,
		}) => {
			expect(attachmentBaseFilename(filename, contentType, fallback)).toBe(expected);
		});

		test("attachmentBaseFilename: output has no invalid filename chars (PBT)", () => {
			fc.assert(
				fc.property(
					fc.oneof(fc.string({ maxLength: 100 }), fc.constant(undefined)),
					fc.oneof(
						fc.constant("application/pdf"),
						fc.constant("image/png"),
						fc.constant(undefined),
					),
					fc.nat(100),
					(filename, contentType, fallback) => {
						const result = attachmentBaseFilename(filename, contentType, fallback);
						const invalid = /[<>:"/\\|?*]/;
						expect(invalid.test(result)).toBe(false);
						expect(result.length).toBeGreaterThan(0);
					},
				),
			);
		});
	});

	describe("Ollama", () => {
		test("buildOllamaRequest", () => {
			const imgContent = new Uint8Array([0xff, 0xd8, 0xff]);
			const imgReq = Option.getOrUndefined(
				buildOllamaRequest(imgContent, "image/jpeg", "llava", "llama2"),
			);
			expect(imgReq).toMatchObject({
				model: "llava",
				prompt: expect.stringContaining("document"),
				images: expect.any(Array),
				stream: false,
			});
			expect(imgReq?.images).toHaveLength(1);

			const textContent = new TextEncoder().encode("invoice total: $100");
			const textReq = Option.getOrUndefined(
				buildOllamaRequest(textContent, "text/plain", "llava", "llama2"),
			);
			expect(textReq).toMatchObject({
				model: "llama2",
				prompt: expect.stringContaining("invoice total"),
				stream: false,
			});
			expect(textReq?.images).toBeUndefined();

			const otherReq = buildOllamaRequest(new Uint8Array(10), "application/pdf", "llava", "llama2");
			expect(Option.isNone(otherReq)).toBe(true);
		});

		test("parseOllamaYesNo", () => {
			expect(parseOllamaYesNo("yes")).toBe(true);
			expect(parseOllamaYesNo("no")).toBe(false);
			expect(parseOllamaYesNo("yes, it is")).toBe(true);
			expect(parseOllamaYesNo("no it is not")).toBe(false);
			expect(parseOllamaYesNo("first no then yes")).toBe(false);
			expect(parseOllamaYesNo("first yes then no")).toBe(true);
			expect(parseOllamaYesNo("maybe")).toBe(true);
		});
	});

	describe("JSON / webhook helpers", () => {
		test.each([
			{ data: { envelope: { sourceNumber: "+1" } }, expected: { sourceNumber: "+1" } },
			{ data: { params: { envelope: { sourceNumber: "+2" } } }, expected: { sourceNumber: "+2" } },
			{
				data: { params: { result: { envelope: { sourceNumber: "+3" } } } },
				expected: { sourceNumber: "+3" },
			},
			{ data: {}, expected: undefined },
		])("getEnvelope($data) -> $expected", ({ data, expected }) => {
			const env = Option.getOrUndefined(getEnvelope(data));
			if (expected === undefined) expect(env).toBeUndefined();
			else expect(env).toMatchObject(expected);
		});

		test.each([
			{ data: { dataMessage: { body: "hi" } }, expected: { body: "hi" } },
			{ data: { envelope: { dataMessage: { message: "hey" } } }, expected: { message: "hey" } },
			{ data: { params: { envelope: { dataMessage: { body: "x" } } } }, expected: { body: "x" } },
			{ data: {}, expected: undefined },
		])("getDataMessage($data) -> $expected", ({ data, expected }) => {
			const dm = Option.getOrUndefined(getDataMessage(data));
			if (expected === undefined) expect(dm).toBeUndefined();
			else expect(dm).toMatchObject(expected);
		});

		test.each([
			{ dm: { body: "  hi  " }, expected: "hi" },
			{ dm: { message: "hey" }, expected: "hey" },
			{ dm: { body: "a", message: "b" }, expected: "a" },
			{ dm: {}, expected: "" },
		])("getDataMessageBody($dm) -> $expected", ({ dm, expected }) => {
			expect(getDataMessageBody(dm)).toBe(expected);
		});

		test.each([
			{ data: { sourceNumber: "+15550000001" }, expected: "+15550000001" },
			{ data: { source: { number: "+15550000002" } }, expected: "+15550000002" },
			{ data: { source: "+15550000003" }, expected: "+15550000003" },
			{ data: { envelope: { sourceNumber: "+15550000004" } }, expected: "+15550000004" },
			{ data: { envelope: { source: { number: "+15550000005" } } }, expected: "+15550000005" },
			{ data: { envelope: { source: "+15550000006" } }, expected: "+15550000006" },
			{
				data: { params: { envelope: { sourceNumber: "+15550000007" } } },
				expected: "+15550000007",
			},
			{ data: { params: { envelope: { source: "+15550000008" } } }, expected: "+15550000008" },
			{ data: {}, expected: undefined },
			{ data: { sourceNumber: "+123" }, expected: undefined },
			{
				data: { sourceNumber: "+15550000001", envelope: { sourceNumber: "+15550000002" } },
				expected: "+15550000001",
			},
		])("resolveSignalSource($data) -> $expected", ({ data, expected }) => {
			expect(Option.getOrUndefined(resolveSignalSource(data))).toBe(expected);
		});

		test.each([
			{ obj: { id: "att1" }, expected: { id: "att1" } },
			{ obj: { customFilename: "doc.pdf" }, expected: { customFilename: "doc.pdf" } },
			{ obj: { contentType: "application/pdf" }, expected: { contentType: "application/pdf" } },
			{
				obj: { id: "x", customFilename: "y.pdf", contentType: "image/png" },
				expected: { id: "x", customFilename: "y.pdf", contentType: "image/png" },
			},
			{ obj: {}, expected: {} },
			{ obj: { id: "a", other: 123 }, expected: { id: "a" } },
		])("parseSignalAttachmentRef($obj) -> $expected", ({ obj, expected }) => {
			expect(parseSignalAttachmentRef(obj)).toEqual(expected);
		});

		test.each([
			{ input: { sourceNumber: "+15550000001" }, expectedKeys: ["sourceNumber"] },
			{ input: { envelope: { dataMessage: { body: "hi" } } }, expectedKeys: ["envelope"] },
			{ input: null, expectedKeys: [] },
			{ input: [], expectedKeys: [] },
			{ input: "string", expectedKeys: [] },
		])("decodeWebhookPayload($input) returns valid payload", ({ input, expectedKeys }) => {
			const payload = decodeWebhookPayload(input);
			expect(typeof payload).toBe("object");
			expect(payload).not.toBeNull();
			for (const k of expectedKeys) {
				expect(payload).toHaveProperty(k);
			}
		});
	});

	describe("authorization", () => {
		test("authorizeSource", () => {
			const reg = createUserRegistry([
				{
					slug: "user1" as UserSlug,
					signalNumber: "+15550000001" as SignalNumber,
					consumeSubdir: "user1" as ConsumeSubdir,
					displayName: "User 1",
					tagName: "User 1",
				},
			]);
			expect(Result.isSuccess(authorizeSource(reg, "+15550000001" as SignalNumber))).toBe(true);
			expect(Result.isSuccess(authorizeSource(reg, "+15550000002" as SignalNumber))).toBe(false);
		});
	});

	describe("formatStatusMessage", () => {
		test("empty accounts", () => {
			const msg = formatStatusMessage([]);
			expect(msg).toContain("No email accounts");
			expect(msg).toContain("gmail add");
		});

		test("with accounts and all categories", () => {
			const accounts: Account[] = [
				{ ...baseAccount, email: "a@example.com" as AccountEmail, _tag: "active" as const },
				{ ...baseAccount, email: "b@example.com" as AccountEmail, _tag: "paused" as const },
				{ ...baseAccount, email: "c@example.com" as AccountEmail, _tag: "removed" as const },
			];

			const msg = formatStatusMessage(accounts);
			expect(msg).toContain("Email Crawl Status");
			expect(msg).toContain("a@example.com: Active");
			expect(msg).toContain("Scanning");
			expect(msg).toContain("b@example.com: Paused");
			expect(msg).toContain("gmail resume");
			expect(msg).toContain("c@example.com: Removed");
			expect(msg).toContain("re-add");
			expect(msg).toContain("gmail add");
		});
	});

	describe("formatDomainError", () => {
		test.each([
			{
				name: "InvalidEmailError",
				errFn: () => new InvalidEmailError({ email: redactedForLog("x", redactEmail) }),
				matcher: "Invalid email",
			},
			{
				name: "IneligibleAttachmentError",
				errFn: () => new IneligibleAttachmentError({ message: "bad" }),
				matcher: (s: string) => s === "bad",
			},
			{
				name: "AppPasswordTooShortError",
				errFn: () => new AppPasswordTooShortError({ message: "too short" }),
				matcher: (s: string) => s === "too short",
			},
			{
				name: "ConfigValidationError",
				errFn: () => new ConfigValidationError({ message: "bad config" }),
				matcher: (s: string) => s === "bad config",
			},
			{
				name: "ConfigValidationError with path",
				errFn: () =>
					new ConfigValidationError({
						message: "bad",
						path: redactedForLog("/etc/config.json", redactPath),
					}),
				matcher: (s: string) => s === "config.json: bad",
			},
			{
				name: "UnauthorizedUserError",
				errFn: () =>
					new UnauthorizedUserError({
						source: redactedForLog("+15550000001" as SignalNumber, redactPhone),
					}),
				matcher: "***0001",
			},
			{
				name: "SignalApiHttpError",
				errFn: () =>
					new SignalApiHttpError({
						status: 500,
						url: redactedForLog("http://x", redactUrl),
						message: "err",
					}),
				matcher: "HTTP 500",
			},
			{
				name: "AttachmentTooLargeError",
				errFn: () => new AttachmentTooLargeError({ size: 100, maxSize: 50 }),
				matcher: "Attachment too large",
			},
			{
				name: "PayloadTooLargeError",
				errFn: () => new PayloadTooLargeError({ size: 100, maxSize: 50 }),
				matcher: "Payload too large",
			},
			{
				name: "OllamaRequestError",
				errFn: () =>
					new OllamaRequestError({
						url: redactedForLog("http://ollama", redactUrl),
						message: "x",
					}),
				matcher: "Ollama",
			},
			{
				name: "ImapConnectionError",
				errFn: () =>
					new ImapConnectionError({
						email: redactedForLog("a@example.com" as AccountEmail, redactEmail),
						message: "x",
					}),
				matcher: "***@example.com",
			},
			{
				name: "ConfigParseError",
				errFn: () =>
					new ConfigParseError({
						path: redactedForLog("/x", redactPath),
						message: "invalid",
					}),
				matcher: "x",
			},
			{
				name: "FileSystemError",
				errFn: () =>
					new FileSystemError({
						path: redactedForLog("/tmp/x", redactPath),
						operation: "writeFile",
						message: "EACCES",
					}),
				matcher: "File system error",
			},
			{
				name: "KeyringError",
				errFn: () =>
					new KeyringError({
						message: "System keychain unavailable",
						operation: "init",
						fix: "Install a Secret Service implementation (see https://specifications.freedesktop.org/secret-service/ for options)",
					}),
				matcher: (s: string) =>
					s.includes("Keyring error (init): System keychain unavailable") &&
					s.includes("specifications.freedesktop.org/secret-service/"),
			},
		])("formats $name", ({ errFn, matcher }) => {
			const result = formatDomainError(errFn());
			if (typeof matcher === "string") {
				expect(result).toContain(matcher);
			} else {
				expect(matcher(result)).toBe(true);
			}
		});
	});

	describe("wrapFs", () => {
		test("wraps raw error as FileSystemError", () => {
			const cause = new Error("EACCES");
			const wrapped = wrapFs("/tmp/x", "writeFile")(cause);
			expect(wrapped).toBeInstanceOf(FileSystemError);
			expect(wrapped).toMatchObject({
				_tag: "FileSystemError",
				operation: "writeFile",
			});
			expect(Redacted.value(wrapped.path)).toBe("/tmp/x");
		});
	});

	describe("auth-failure", () => {
		test.each([
			{ msg: "Authentication failed", expected: true },
			{ msg: "Invalid credentials", expected: true },
			{ msg: "Login failed", expected: true },
			{ msg: "login failed", expected: true },
			{ msg: "Access denied", expected: true },
			{ msg: "Unauthorized", expected: true },
			{ msg: "Connection timeout", expected: false },
			{ msg: "Network error", expected: false },
			{ msg: "IMAP error", expected: false },
		])("isAuthFailure($msg) -> $expected", ({ msg, expected }) => {
			expect(isAuthFailure(msg)).toBe(expected);
		});

		test("formatCredentialFailureMessage", () => {
			const msg = formatCredentialFailureMessage(
				"user@example.com",
				"krzysiek" as UserSlug,
				"Krzysiek",
			);
			expect(msg).toContain("user@example.com");
			expect(msg).toContain("Krzysiek");
			expect(msg).toContain("gmail add");
		});

		test("formatCredentialFailureMessage without displayName uses addedBy", () => {
			const msg = formatCredentialFailureMessage("a@b.com", "slug1" as UserSlug);
			expect(msg).toContain("slug1");
		});

		const FIXED_NOW = Temporal.Instant.from("2024-01-15T12:00:00Z");

		test("shouldNotify: no lastNotified returns true", () => {
			expect(shouldNotify(undefined, FIXED_NOW)).toBe(true);
		});

		test("shouldNotify: recent timestamp returns false", () => {
			const recent = FIXED_NOW.subtract(Temporal.Duration.from({ seconds: 1 }));
			expect(shouldNotify(recent, FIXED_NOW, Temporal.Duration.from({ hours: 1 }))).toBe(false);
		});

		test("shouldNotify: old timestamp returns true", () => {
			const old = FIXED_NOW.subtract(Temporal.Duration.from({ hours: 25 }));
			expect(shouldNotify(old, FIXED_NOW, Temporal.Duration.from({ hours: 24 }))).toBe(true);
		});
	});

	describe("accounts", () => {
		test("upsertAccount add and update", () => {
			const email = Schema.decodeSync(AccountEmailSchema)("u@example.com");
			const accounts = upsertAccount([], email, Redacted.make("a".repeat(16)), "user1" as UserSlug);
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.email).toBe("u@example.com");
			const updated = upsertAccount(
				accounts,
				email,
				Redacted.make("b".repeat(16)),
				"user1" as UserSlug,
			);
			expect(updated).toHaveLength(1);
			const first = updated[0];
			expect(first).toBeDefined();
			if (first) expect(Redacted.value(first.appPassword)).toBe("b".repeat(16));
		});

		test("upsertAccount preserves excludeLabels on update", () => {
			const email = Schema.decodeSync(AccountEmailSchema)("u@example.com");
			const withLabels: Account[] = [
				{
					...baseAccount,
					email,
					excludeLabels: ["SPAM" as EmailLabel, "TRASH" as EmailLabel],
				},
			];
			const updated = upsertAccount(
				withLabels,
				email,
				Redacted.make("newpass".repeat(3)),
				"user1" as UserSlug,
			);
			expect(updated[0]?.excludeLabels).toEqual(["SPAM", "TRASH"]);
		});

		test.each([
			{ from: "active" as const, to: "paused" as const, expected: "paused" as const },
			{ from: "active" as const, to: "removed" as const, expected: "removed" as const },
			{ from: "paused" as const, to: "active" as const, expected: "active" as const },
			{ from: "paused" as const, to: "removed" as const, expected: "removed" as const },
			{ from: "active" as const, to: "active" as const, expected: "active" as const },
			{ from: "paused" as const, to: "paused" as const, expected: "paused" as const },
			{ from: "removed" as const, to: "removed" as const, expected: "removed" as const },
			{ from: "removed" as const, to: "active" as const, expected: "removed" as const },
			{ from: "removed" as const, to: "paused" as const, expected: "removed" as const },
		])("transitionAccount $from -> $to", ({ from, to, expected }) => {
			const acc = { ...baseAccount, _tag: from } as Account;
			const next = transitionAccount(acc, to);
			expect(next._tag).toBe(expected);
		});
	});
});
