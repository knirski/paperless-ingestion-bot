import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
	GENERIC_DEFAULT_EXCLUDE_LABELS,
	GMAIL_DEFAULT_EXCLUDE_LABELS,
	GMAIL_PRESET,
	resolveImapConfig,
} from "../src/domain/imap-provider.js";
import { type EmailLabel, EmailLabelSchema } from "../src/domain/types.js";

describe("resolveImapConfig", () => {
	test("gmail preset returns Gmail config", () => {
		const config = resolveImapConfig("gmail", "paperless" as EmailLabel);
		expect(config).toMatchObject({
			provider: "gmail",
			host: "imap.gmail.com",
			port: 993,
			secure: true,
			mailbox: "[Gmail]/All Mail",
			markProcessedLabel: "paperless",
			markProcessedStrategy: "label",
		});
		expect(config.defaultExcludeLabels).toEqual([...GMAIL_DEFAULT_EXCLUDE_LABELS]);
	});

	test("generic returns default host/port/mailbox", () => {
		const config = resolveImapConfig("generic", "paperless" as EmailLabel);
		expect(config).toMatchObject({
			provider: "generic",
			host: "localhost",
			port: 993,
			secure: true,
			mailbox: "INBOX",
			markProcessedStrategy: "flag",
			markProcessedLabel: "paperless",
		});
		expect(config.defaultExcludeLabels).toEqual([...GENERIC_DEFAULT_EXCLUDE_LABELS]);
	});

	test("generic with empty markProcessedLabel uses $Paperless", () => {
		const config = resolveImapConfig("generic", Schema.decodeSync(EmailLabelSchema)(""));
		expect(config.markProcessedLabel).toBe("$Paperless" as unknown as EmailLabel);
	});

	test("generic accepts overrides", () => {
		const config = resolveImapConfig("generic", "paperless" as EmailLabel, {
			host: "imap.example.com",
			port: 143,
			secure: false,
			mailbox: "Archive",
		});
		expect(config).toMatchObject({
			host: "imap.example.com",
			port: 143,
			secure: false,
			mailbox: "Archive",
		});
	});
});

describe("GMAIL_PRESET", () => {
	test("has expected structure", () => {
		expect(GMAIL_PRESET.provider).toBe("gmail");
		expect(GMAIL_PRESET.host).toBe("imap.gmail.com");
		expect(GMAIL_PRESET.markProcessedStrategy).toBe("label");
	});
});
