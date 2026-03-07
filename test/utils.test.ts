import { describe, expect, test } from "vitest";
import {
	ConfigParseError,
	formatErrorForStructuredLog,
	ImapConnectionError,
} from "../src/domain/errors.js";
import type { AccountEmail } from "../src/domain/types.js";
import { assertNever, errorToLogMessage, unknownToMessage } from "../src/domain/utils.js";

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
			email: "a@b.com" as AccountEmail,
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
		const err = new ConfigParseError({ path: "/x", message: "bad json" });
		const formatDomainError = (e: { _tag: string }) =>
			e._tag === "ConfigParseError" ? "Config parse error at /x: bad json" : String(e);
		expect(errorToLogMessage(err, formatDomainError)).toBe("Config parse error at /x: bad json");
	});
});

describe("formatErrorForStructuredLog", () => {
	test("DomainError uses formatDomainError", () => {
		const err = new ImapConnectionError({
			email: "a@b.com" as AccountEmail,
			message: "auth failed",
		});
		expect(formatErrorForStructuredLog(err)).toContain("IMAP connection failed");
		expect(formatErrorForStructuredLog(err)).toContain("a@b.com");
	});

	test("plain Error uses unknownToMessage", () => {
		expect(formatErrorForStructuredLog(new Error("network timeout"))).toBe("network timeout");
	});
});
