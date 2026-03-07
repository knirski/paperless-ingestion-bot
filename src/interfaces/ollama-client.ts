/**
 * Ollama client service — document assessment via local Ollama.
 * Tagless Final: interface only; live interpreter in ollama-client-live.ts.
 *
 * Future path: Effect AI (effect/unstable/ai) could provide a service-agnostic
 * LanguageModel layer. OpenRouter, OpenAI, or other providers could be swapped
 * via config without changing callers. The OllamaClient interface would be
 * replaced by LanguageModel.generateText().
 */

import type { AppEffect } from "../domain/types.js";

/** Ollama assessment request. */
export interface OllamaRequest {
	readonly model: string;
	readonly prompt: string;
	readonly images?: readonly string[];
	readonly stream?: boolean;
}

export interface OllamaClientService {
	readonly assess: (request: OllamaRequest) => AppEffect<boolean>;
}
