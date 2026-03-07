/** Ollama request building and response parsing. */

import { Option } from "effect";
import { parseContentTypeBase } from "../domain/mime.js";
import type { OllamaRequest } from "../interfaces/ollama-client.js";

const YES_PATTERN = /\byes\b/i;
const NO_PATTERN = /\bno\b/i;

const OLLAMA_VISION_PROMPT =
	"Look at this image. Is it a document, receipt, invoice, scan, form, contract, letter, or official paper? Answer only YES or NO.";
const OLLAMA_TEXT_PROMPT =
	"Is this text content a formal document worth archiving (invoice, receipt, contract, notice, report)? Or is it casual/marketing content? Answer only YES or NO.\n\nContent:\n{content}";

/** Build Ollama request from content (image or text) for document assessment. */
export function buildOllamaRequest(
	content: Uint8Array,
	contentType: string,
	visionModel: string,
	textModel: string,
): Option.Option<OllamaRequest> {
	const ct = parseContentTypeBase(contentType);

	if (ct.startsWith("image/")) {
		const base64 = Buffer.from(content).toString("base64");
		return Option.some({
			model: visionModel,
			prompt: OLLAMA_VISION_PROMPT,
			images: [base64],
			stream: false,
		});
	}

	if (ct === "text/plain" || ct === "text/csv") {
		const text = new TextDecoder().decode(content).slice(0, 2000);
		return Option.some({
			model: textModel,
			prompt: OLLAMA_TEXT_PROMPT.replace("{content}", text),
			stream: false,
		});
	}

	return Option.none();
}

/** Parse Ollama yes/no response. */
export function parseOllamaYesNo(response: string): boolean {
	const hasYes = YES_PATTERN.test(response);
	const hasNo = NO_PATTERN.test(response);
	if (hasYes && !hasNo) return true;
	if (hasNo && !hasYes) return false;
	if (hasYes && hasNo) {
		const yesMatch = response.match(YES_PATTERN);
		const noMatch = response.match(NO_PATTERN);
		if (yesMatch && noMatch) return (yesMatch.index ?? 0) < (noMatch.index ?? 0);
	}
	return true;
}
