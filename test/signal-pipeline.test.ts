import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AccountEmail } from "../src/domain/types.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import {
	collectValidAttachmentRefs,
	formatGmailAddReply,
	formatPauseIngestionReply,
	formatRemoveAccountReply,
	formatResumeIngestionReply,
	MAX_ATTACHMENTS_PER_MESSAGE,
	trimAttachmentsToMax,
	validateConsumeDir,
} from "../src/shell/signal-pipeline.js";
import { createTestTempDir, SilentLoggerLayer } from "./test-utils.js";

describe("signal-pipeline", () => {
	describe("collectValidAttachmentRefs", () => {
		test.each([
			{ input: [], expected: [] },
			{
				input: [{ id: "att1", contentType: "application/pdf", customFilename: "doc.pdf" }],
				expected: [{ id: "att1", contentType: "application/pdf", customFilename: "doc.pdf" }],
			},
			{ input: [{ customFilename: "a.pdf" }], expected: [] },
			{
				input: [null, { id: "att1", contentType: "application/pdf" }],
				expected: [{ id: "att1", contentType: "application/pdf" }],
			},
			{
				input: [[], { id: "att1", contentType: "application/pdf" }],
				expected: [{ id: "att1", contentType: "application/pdf" }],
			},
			{
				input: ["string", 42, true, undefined, { id: "att1", contentType: "application/pdf" }],
				expected: [{ id: "att1", contentType: "application/pdf" }],
			},
			{
				input: [
					{ customFilename: "no-id.pdf" },
					null,
					{ id: "att1", contentType: "application/pdf" },
					[],
					{ id: "att2", contentType: "image/jpeg" },
				],
				expected: [
					{ id: "att1", contentType: "application/pdf" },
					{ id: "att2", contentType: "image/jpeg" },
				],
			},
			{ input: [{ id: "att1" }], expected: [{ id: "att1" }] },
		])("filters invalid refs", ({ input, expected }) => {
			const result = collectValidAttachmentRefs(input as unknown as readonly unknown[]);
			expect(result).toEqual(expected as unknown as typeof result);
		});
	});

	describe("validateConsumeDir", () => {
		test("fails when directory does not exist", async () => {
			const program = validateConsumeDir("/nonexistent/path/12345").pipe(
				Effect.provide(PlatformServicesLayer),
				Effect.provide(SilentLoggerLayer),
			);
			await expect(Effect.runPromise(program)).rejects.toMatchObject({
				_tag: "ConfigValidationError",
				message: "consume_dir does not exist",
			});
		});

		test("succeeds when directory exists and is writable", async () => {
			const { path: tmpDir, remove } = await createTestTempDir("validate-consume-");
			try {
				const program = validateConsumeDir(tmpDir).pipe(
					Effect.provide(PlatformServicesLayer),
					Effect.provide(SilentLoggerLayer),
				);
				await Effect.runPromise(program);
			} finally {
				await remove();
			}
		});
	});

	describe("trimAttachmentsToMax", () => {
		test("returns all when under limit", () => {
			const arr = [1, 2, 3];
			expect(trimAttachmentsToMax(arr)).toEqual([1, 2, 3]);
		});

		test("trims to MAX_ATTACHMENTS_PER_MESSAGE when over", () => {
			const arr = Array.from({ length: 25 }, (_, i) => i);
			const result = trimAttachmentsToMax(arr);
			expect(result).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
			expect(result).toEqual(Array.from({ length: 20 }, (_, i) => i));
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
