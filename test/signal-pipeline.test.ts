import { describe, expect, test } from "bun:test";
import { validateAttachmentsToRaw } from "../src/core/index.js";
import type { SignalAttachmentRef } from "../src/domain/signal-types.js";
import type { AccountEmail } from "../src/domain/types.js";
import {
	formatGmailAddReply,
	formatPauseIngestionReply,
	formatRemoveAccountReply,
	formatResumeIngestionReply,
	MAX_ATTACHMENTS_PER_MESSAGE,
	trimAttachmentsToMax,
} from "../src/shell/signal-pipeline.js";

describe("signal-pipeline", () => {
	describe("validateAttachmentsToRaw", () => {
		test("empty array succeeds", () => {
			const result = validateAttachmentsToRaw([]);
			expect(result._tag).toBe("Success");
			if (result._tag === "Success") expect(result.success).toEqual([]);
		});

		test("valid refs succeed", () => {
			const input: SignalAttachmentRef[] = [
				{ id: "att1", contentType: "application/pdf", customFilename: "doc.pdf" },
			];
			const result = validateAttachmentsToRaw(input);
			expect(result._tag).toBe("Success");
			if (result._tag === "Success") {
				expect(result.success).toHaveLength(1);
				expect(result.success[0]).toMatchObject({
					id: "att1",
					contentType: "application/pdf",
					customFilename: "doc.pdf",
				});
			}
		});

		test("ref without id fails", () => {
			const input: SignalAttachmentRef[] = [{ customFilename: "a.pdf" }];
			const result = validateAttachmentsToRaw(input);
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure")
				expect(result.failure).toMatchObject({
					_tag: "InvalidAttachmentRefError",
					message: "Attachment ref missing required id",
					index: 0,
				});
		});

		test("ref with invalid id fails", () => {
			const input: SignalAttachmentRef[] = [{ id: "" }];
			const result = validateAttachmentsToRaw(input);
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure")
				expect(result.failure).toMatchObject({
					_tag: "InvalidAttachmentRefError",
					index: 0,
				});
		});

		test("fails on first invalid", () => {
			const input: SignalAttachmentRef[] = [
				{ customFilename: "no-id.pdf" },
				{ id: "att1", contentType: "application/pdf" },
			];
			const result = validateAttachmentsToRaw(input);
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") expect(result.failure.index).toBe(0);

			const input2: SignalAttachmentRef[] = [
				{ id: "att1", contentType: "application/pdf" },
				{ id: "att2", contentType: "image/jpeg" },
			];
			const result2 = validateAttachmentsToRaw(input2);
			expect(result2._tag).toBe("Success");
			if (result2._tag === "Success") expect(result2.success).toHaveLength(2);
		});
	});

	describe("trimAttachmentsToMax", () => {
		test("returns all when under limit", () => {
			const valid = validateAttachmentsToRaw([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
			if (valid._tag !== "Success") throw new Error("unexpected");
			const result = trimAttachmentsToMax(valid.success);
			expect(result).toHaveLength(3);
		});

		test("trims to MAX_ATTACHMENTS_PER_MESSAGE when over", () => {
			const refs = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 5 }, (_, i) => ({
				id: `att${i}`,
			}));
			const valid = validateAttachmentsToRaw(refs);
			if (valid._tag !== "Success") throw new Error("unexpected");
			const result = trimAttachmentsToMax(valid.success);
			expect(result).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
		});

		test("returns empty for empty input", () => {
			expect(trimAttachmentsToMax([])).toEqual([]);
		});
	});

	const testEmail = "user@example.com" as AccountEmail;

	describe("formatGmailAddReply", () => {
		test("new account", () => {
			expect(formatGmailAddReply(testEmail, false)).toContain("Added user@example.com");
			expect(formatGmailAddReply(testEmail, false)).toContain("saved");
		});

		test("reactivation", () => {
			expect(formatGmailAddReply(testEmail, true)).toContain("Re-activated user@example.com");
			expect(formatGmailAddReply(testEmail, true)).toContain("label-based");
		});
	});

	describe("formatPauseIngestionReply", () => {
		test("found", () => {
			expect(formatPauseIngestionReply(testEmail, true)).toContain("Paused scanning");
			expect(formatPauseIngestionReply(testEmail, true)).toContain("gmail resume user@example.com");
		});

		test("not found", () => {
			expect(formatPauseIngestionReply(testEmail, false)).toContain("No account found");
			expect(formatPauseIngestionReply(testEmail, false)).toContain("gmail status");
		});
	});

	describe("formatRemoveAccountReply", () => {
		test("found", () => {
			expect(formatRemoveAccountReply(testEmail, true)).toContain("Removed user@example.com");
			expect(formatRemoveAccountReply(testEmail, true)).toContain("gmail add");
		});

		test("not found", () => {
			expect(formatRemoveAccountReply(testEmail, false)).toContain("No account found");
		});
	});

	describe("formatResumeIngestionReply", () => {
		test("not_found", () => {
			expect(formatResumeIngestionReply(testEmail, "not_found")).toContain("No account found");
			expect(formatResumeIngestionReply(testEmail, "not_found")).toContain("gmail status");
		});

		test("removed", () => {
			expect(formatResumeIngestionReply(testEmail, "removed")).toContain("was removed");
			expect(formatResumeIngestionReply(testEmail, "removed")).toContain(
				"gmail add user@example.com",
			);
		});

		test("active", () => {
			expect(formatResumeIngestionReply(testEmail, "active")).toContain(
				"Resumed scanning for user@example.com",
			);
		});
	});
});
