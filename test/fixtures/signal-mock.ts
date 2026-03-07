import { Effect, Layer, Option } from "effect";
import { ConfigValidationError } from "../../src/domain/errors.js";
import type { SignalNumber } from "../../src/domain/signal-types.js";
import { SignalClient } from "../../src/live/signal-client.js";

const DEFAULT_ACCOUNT = "+15550000001" as SignalNumber;

/** Static or callback-based responses. Callbacks override static values. */
export interface SignalMockScenario {
	getAccountResult?: Option.Option<SignalNumber>;
	fetchAttachmentData?: Record<string, Uint8Array>;
	fetchAttachmentCb?: (id: string) => Uint8Array;
	/** When set, fetchAttachment returns Effect.fail. */
	fetchAttachmentFail?: unknown;
	/** When set, sendMessage returns Effect.fail. */
	sendMessageFail?: unknown;
}

/** Captured calls for assertions. Mutated by the mock (test-only). */
export interface SignalMockSpy {
	sendMessageCalls: { account: SignalNumber; recipient: string; message: string }[];
	fetchAttachmentCalls: string[];
	getAccountCalls: number;
}

export function createSignalMockLayer(
	scenario: SignalMockScenario,
	options?: { spy?: SignalMockSpy; defaultAccount?: SignalNumber },
) {
	const spy = options?.spy;
	const defaultAccount = options?.defaultAccount ?? DEFAULT_ACCOUNT;

	return Layer.succeed(SignalClient)(
		SignalClient.of({
			getAccount: () => {
				if (spy) spy.getAccountCalls++;
				const result = scenario.getAccountResult ?? Option.some(defaultAccount);
				return Effect.succeed(result);
			},
			sendMessage: (account, recipient, message) => {
				if (spy) spy.sendMessageCalls.push({ account, recipient, message });
				if (scenario.sendMessageFail !== undefined)
					return Effect.fail(
						new ConfigValidationError({
							message: String(scenario.sendMessageFail),
						}),
					);
				return Effect.void;
			},
			fetchAttachment: (id) => {
				if (spy) spy.fetchAttachmentCalls.push(id);
				if (scenario.fetchAttachmentFail !== undefined)
					return Effect.fail(
						new ConfigValidationError({
							message: String(scenario.fetchAttachmentFail),
						}),
					);
				const data =
					scenario.fetchAttachmentCb?.(id) ??
					scenario.fetchAttachmentData?.[id] ??
					new Uint8Array(0);
				return Effect.succeed(data);
			},
		}),
	);
}
