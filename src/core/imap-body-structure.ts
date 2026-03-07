/**
 * Pure parsing of IMAP MIME body structure.
 * Extracts attachment parts for download — no I/O, no Effect.
 * Compatible with imapflow MessageStructureObject (structural typing).
 */

/** Minimal shape for MIME body structure node (imapflow-compatible). */
interface BodyStructureNode {
	readonly type: string;
	readonly disposition?: string;
	readonly parameters?: Record<string, string>;
	readonly dispositionParameters?: Record<string, string>;
	readonly size?: number;
	readonly childNodes?: readonly BodyStructureNode[];
}

/** Attachment part extracted from MIME body structure — used for download. */
interface AttachmentPart {
	readonly partId: string;
	readonly contentType: string;
	readonly filename: string | undefined;
	readonly size: number;
}

export function isMessageStructure(obj: unknown): obj is BodyStructureNode {
	return (
		obj !== null &&
		typeof obj === "object" &&
		"type" in obj &&
		typeof (obj as BodyStructureNode).type === "string"
	);
}

export function toContentType(node: BodyStructureNode): string {
	const t = node.type ?? "";
	return t.includes("/") ? t : t ? `${t}/octet-stream` : "application/octet-stream";
}

export function toFilename(node: BodyStructureNode): string | undefined {
	return (
		node.dispositionParameters?.filename ??
		node.dispositionParameters?.name ??
		node.parameters?.name ??
		node.parameters?.filename
	);
}

/** Recursively collect attachment parts from MIME body structure. */
export function collectAttachmentParts(structure: unknown, prefix = ""): AttachmentPart[] {
	if (!isMessageStructure(structure)) return [];
	const part = structure;
	const partId = prefix || "1";

	const self =
		part.disposition === "attachment"
			? [
					{
						partId,
						contentType: toContentType(part),
						filename: toFilename(part),
						size: part.size ?? 0,
					},
				]
			: [];

	const children = Array.isArray(part.childNodes)
		? part.childNodes.flatMap((child, i) => collectAttachmentParts(child, `${partId}.${i + 1}`))
		: [];

	return [...self, ...children];
}
