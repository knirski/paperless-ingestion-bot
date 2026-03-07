import { describe, expect, test } from "vitest";
import { ConfigValidationError, formatErrorForStructuredLog } from "../src/domain/errors.js";
import { redactedForLog, redactPath } from "../src/domain/utils.js";

describe("formatErrorForStructuredLog (used by CLI reporter)", () => {
	test.each([
		{
			desc: "DomainError uses formatDomainError",
			original: new ConfigValidationError({
				message: "Bad config",
				path: redactedForLog("/etc/config.json", redactPath),
				fix: "Fix it",
			}),
			expectedContain: "Bad config",
			expectedNotContain: "fallback",
		},
		{
			desc: "plain Error uses message",
			original: new Error("fallback message"),
			expectedContain: "fallback message",
		},
		{
			desc: "null uses String conversion",
			original: null,
			expectedContain: "null",
		},
		{
			desc: "object without _tag uses unknownToMessage",
			original: { message: "not a DomainError" },
			expectedContain: "[object Object]",
		},
	])("$desc", ({ original, expectedContain, expectedNotContain }) => {
		const result = formatErrorForStructuredLog(original);
		expect(result).toContain(expectedContain);
		if (expectedNotContain) {
			expect(result).not.toContain(expectedNotContain);
		}
	});
});
