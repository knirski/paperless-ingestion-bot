import { Effect, Layer } from "effect";
import type { TagName } from "../../src/domain/paperless-types.js";
import { PaperlessClient } from "../../src/live/paperless-client.js";

/** Captured upload calls for assertions. Mutated by the mock (test-only). */
export interface PaperlessMockSpy {
	uploadCalls: { filename: string; tags: readonly TagName[] }[];
}

export function createPaperlessMockLayer(spy?: PaperlessMockSpy): Layer.Layer<PaperlessClient> {
	return Layer.succeed(PaperlessClient)(
		PaperlessClient.of({
			uploadDocument: (_document: Uint8Array, filename: string, tags: readonly TagName[]) => {
				if (spy) spy.uploadCalls.push({ filename, tags });
				return Effect.void;
			},
		}),
	);
}
