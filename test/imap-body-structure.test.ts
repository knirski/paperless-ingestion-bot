import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
	collectAttachmentParts,
	isMessageStructure,
	toContentType,
	toFilename,
} from "../src/core/imap-body-structure.js";

describe("imap-body-structure", () => {
	describe("isMessageStructure", () => {
		test.each([
			{ input: { type: "application", subtype: "pdf" }, expected: true },
			{ input: { type: "text/plain" }, expected: true },
		])("returns true for valid structure", ({ input, expected }) => {
			expect(isMessageStructure(input)).toBe(expected);
		});

		test.each([
			{ input: null },
			{ input: undefined },
			{ input: "string" },
			{ input: 123 },
			{ input: {} },
			{ input: { disposition: "attachment" } },
			{ input: { type: 123 } },
		])("returns false for invalid: $input", ({ input }) => {
			expect(isMessageStructure(input)).toBe(false);
		});
	});

	describe("toContentType", () => {
		test.each([
			{ type: "application/pdf", expected: "application/pdf" },
			{ type: "text/plain", expected: "text/plain" },
			{ type: "application", expected: "application/octet-stream" },
			{ type: "text", expected: "text/octet-stream" },
			{ type: "", expected: "application/octet-stream" },
		])("toContentType($type) -> $expected", ({ type, expected }) => {
			expect(toContentType({ type })).toBe(expected);
		});

		test("toContentType: type with slash returns as-is (PBT)", () => {
			fc.assert(
				fc.property(
					fc
						.tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }))
						.map(([a, b]) => `${a}/${b}`),
					(type) => {
						expect(toContentType({ type })).toBe(type);
					},
				),
			);
		});
	});

	describe("toFilename", () => {
		test.each([
			{
				node: {
					type: "application",
					dispositionParameters: { filename: "doc.pdf" },
					parameters: { name: "other.pdf" },
				},
				expected: "doc.pdf",
			},
			{
				node: { type: "application", dispositionParameters: { name: "inline.pdf" } },
				expected: "inline.pdf",
			},
			{ node: { type: "application", parameters: { name: "param.pdf" } }, expected: "param.pdf" },
			{
				node: { type: "application", parameters: { filename: "param-filename.pdf" } },
				expected: "param-filename.pdf",
			},
			{ node: { type: "application" }, expected: undefined },
		])("toFilename fallback order", ({ node, expected }) => {
			expect(toFilename(node)).toBe(expected);
		});
	});

	describe("collectAttachmentParts", () => {
		test.each([
			{ structure: null },
			{ structure: {} },
			{ structure: "invalid" },
		])("returns empty for invalid: $structure", ({ structure }) => {
			expect(collectAttachmentParts(structure)).toEqual([]);
		});

		test("returns empty when disposition is not attachment", () => {
			expect(
				collectAttachmentParts({
					type: "text",
					disposition: "inline",
				}),
			).toEqual([]);
		});

		test.each([
			{
				structure: {
					type: "application",
					disposition: "attachment",
					dispositionParameters: { filename: "doc.pdf" },
					size: 1024,
				},
				expected: [
					{
						partId: "1",
						contentType: "application/octet-stream",
						filename: "doc.pdf",
						size: 1024,
					},
				],
			},
			{
				structure: {
					type: "application/pdf",
					disposition: "attachment",
					parameters: { name: "report.pdf" },
				},
				expected: [
					{
						partId: "1",
						contentType: "application/pdf",
						filename: "report.pdf",
						size: 0,
					},
				],
			},
			{
				structure: { type: "application", disposition: "attachment" },
				prefix: "2.3",
				expected: [
					{
						partId: "2.3",
						contentType: "application/octet-stream",
						filename: undefined,
						size: 0,
					},
				],
			},
			{
				structure: { type: "application", disposition: "attachment" },
				prefix: "",
				expected: [
					{
						partId: "1",
						contentType: "application/octet-stream",
						filename: undefined,
						size: 0,
					},
				],
			},
		])("extracts attachment", ({ structure, prefix, expected }) => {
			const result =
				prefix === undefined
					? collectAttachmentParts(structure)
					: collectAttachmentParts(structure, prefix);
			expect(result).toEqual(expected);
		});

		test("extracts nested attachments from childNodes", () => {
			const structure = {
				type: "multipart",
				disposition: "inline",
				childNodes: [
					{ type: "text", disposition: "inline" },
					{
						type: "application",
						disposition: "attachment",
						dispositionParameters: { filename: "attach.pdf" },
						size: 512,
					},
				],
			};
			expect(collectAttachmentParts(structure)).toEqual([
				{
					partId: "1.2",
					contentType: "application/octet-stream",
					filename: "attach.pdf",
					size: 512,
				},
			]);
		});

		test("extracts multiple attachments at same level", () => {
			const structure = {
				type: "multipart",
				childNodes: [
					{
						type: "application",
						disposition: "attachment",
						dispositionParameters: { filename: "a.pdf" },
					},
					{
						type: "application",
						disposition: "attachment",
						dispositionParameters: { filename: "b.pdf" },
					},
				],
			};
			expect(collectAttachmentParts(structure)).toEqual([
				{
					partId: "1.1",
					contentType: "application/octet-stream",
					filename: "a.pdf",
					size: 0,
				},
				{
					partId: "1.2",
					contentType: "application/octet-stream",
					filename: "b.pdf",
					size: 0,
				},
			]);
		});

		test("collectAttachmentParts: invalid input always returns [] (PBT)", () => {
			const invalidArb = fc.oneof(
				fc.constant(null),
				fc.constant(undefined),
				fc.string(),
				fc.integer(),
				fc.boolean(),
				fc.array(fc.anything()),
			);
			fc.assert(
				fc.property(invalidArb, (structure) => {
					const result = collectAttachmentParts(structure as unknown);
					expect(result).toEqual([]);
				}),
			);
		});
	});
});
