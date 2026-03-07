import { Redacted } from "effect";
import { describe, expect, test } from "vitest";
import {
	ConfigParseError,
	formatErrorForStructuredLog,
	ImapConnectionError,
} from "../src/domain/errors.js";
import type { AccountEmail } from "../src/domain/types.js";
import {
	assertNever,
	errorToLogMessage,
	redactEmail,
	redactedForLog,
	redactPath,
	redactPhone,
	redactUrl,
	unknownToMessage,
} from "../src/domain/utils.js";

describe("assertNever", () => {
	test("throws when reached (exhaustiveness check)", () => {
		expect(() => assertNever("unexpected" as never)).toThrow("Unexpected value");
	});
});

describe("unknownToMessage", () => {
	test("Error returns message", () => {
		expect(unknownToMessage(new Error("foo"))).toBe("foo");
	});

	test("string returns as-is", () => {
		expect(unknownToMessage("bar")).toBe("bar");
	});

	test("number converts to string", () => {
		expect(unknownToMessage(42)).toBe("42");
	});

	test("null converts to string", () => {
		expect(unknownToMessage(null)).toBe("null");
	});
});

describe("errorToLogMessage", () => {
	test("DomainError uses formatter", () => {
		const err = new ImapConnectionError({
			email: redactedForLog("a@b.com" as AccountEmail, redactEmail),
			message: "auth failed",
		});
		const formatter = (e: { _tag: string }) =>
			e._tag === "ImapConnectionError" ? "IMAP failed" : String(e);
		expect(errorToLogMessage(err, formatter)).toBe("IMAP failed");
	});

	test("non-domain object with _tag falls back when formatter throws", () => {
		const err = { _tag: "UnknownTag" };
		const formatter = () => {
			throw new Error("no match");
		};
		expect(errorToLogMessage(err, formatter)).toBe("[object Object]");
	});

	test("plain Error uses unknownToMessage", () => {
		expect(errorToLogMessage(new Error("oops"), () => "ignored")).toBe("oops");
	});

	test("ConfigParseError formatted via formatDomainError", () => {
		const err = new ConfigParseError({
			path: redactedForLog("/x", redactPath),
			message: "bad json",
		});
		const formatDomainError = (e: { _tag: string }) =>
			e._tag === "ConfigParseError" ? "Config parse error at x: bad json" : String(e);
		expect(errorToLogMessage(err, formatDomainError)).toBe("Config parse error at x: bad json");
	});
});

describe("formatErrorForStructuredLog", () => {
	test("DomainError uses formatDomainError", () => {
		const err = new ImapConnectionError({
			email: redactedForLog("a@b.com" as AccountEmail, redactEmail),
			message: "auth failed",
		});
		expect(formatErrorForStructuredLog(err)).toContain("IMAP connection failed");
		expect(formatErrorForStructuredLog(err)).toContain("***@b.com");
	});

	test("plain Error uses unknownToMessage", () => {
		expect(formatErrorForStructuredLog(new Error("network timeout"))).toBe("network timeout");
	});
});

describe("log redaction", () => {
	test("redactPath shows basename only", () => {
		expect(redactPath("/home/user/.config/paperless/config.json")).toBe("config.json");
		expect(redactPath("/x")).toBe("x");
		expect(redactPath("config.json")).toBe("config.json");
	});
	test("redactEmail shows domain only", () => {
		expect(redactEmail("user@example.com")).toBe("***@example.com");
		expect(redactEmail("a@b.com")).toBe("***@b.com");
	});
	test("redactPhone shows last 4 digits", () => {
		expect(redactPhone("+15551234567")).toBe("***4567");
		expect(redactPhone("123")).toBe("***");
	});
	test("redactUrl strips query and fragment", () => {
		expect(redactUrl("http://localhost:8080/v1/send?token=secret")).toBe(
			"http://localhost:8080/v1/send",
		);
		expect(redactUrl("http://x")).toBe("http://x");
	});
});

describe("redactedForLog", () => {
	test("wraps value with label from redact fn", () => {
		const r = redactedForLog("user@example.com", redactEmail);
		expect(Redacted.value(r)).toBe("user@example.com");
		expect(r.label).toBe("***@example.com");
	});
	test("label fallback for unlabeled Redacted", () => {
		const r = redactedForLog("/home/user/config.json", redactPath);
		expect(r.label).toBe("config.json");
		const unlabeled = Redacted.make("secret");
		expect(unlabeled.label ?? "<redacted>").toBe("<redacted>");
	});
});
