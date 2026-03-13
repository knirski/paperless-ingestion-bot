/**
 * Collapse newlines within prose paragraphs for PR descriptions.
 * Paragraphs stay separate; lists and code blocks are preserved; only paragraph
 * content (72-char line wraps) is unwrapped. Used when generating PR body from
 * commit messages. See docs/PR_TEMPLATE.md.
 */

import type { PhrasingContent, Root, Text } from "mdast";
import { remark } from "remark";
import { visit } from "unist-util-visit";

/** Fallback when remark parsing fails: collapse newlines within paragraphs. */
function fallback(text: string): string {
	return text
		.split(/\n\n+/)
		.map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n\n");
}

/** Pure: map phrasing content, collapsing breaks and normalizing text. */
function collapsePhrasingContent(child: PhrasingContent): PhrasingContent {
	if (child.type === "break") {
		return { type: "text", value: " " } satisfies Text;
	}
	if (child.type === "text") {
		return { ...child, value: child.value.replace(/\n/g, " ") };
	}
	return child;
}

/** Pure: transform paragraph children (breaks → space, text newlines → space). */
function collapseParagraphChildren(children: PhrasingContent[]): PhrasingContent[] {
	return children.map(collapsePhrasingContent);
}

function collapseParagraphBreaks() {
	return (tree: Root) => {
		visit(tree, "paragraph", (node) => {
			node.children = collapseParagraphChildren(node.children);
		});
	};
}

const processor = remark().use(collapseParagraphBreaks);

/**
 * Collapse newlines within prose paragraphs. Lists and code blocks preserved.
 * Falls back to heuristic on parse error.
 */
export function collapseProseParagraphs(text: string): string {
	if (!text.trim()) return text;
	try {
		const result = processor.processSync(text);
		return String(result).trim();
	} catch {
		return fallback(text);
	}
}
