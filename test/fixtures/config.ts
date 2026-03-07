import { Layer } from "effect";
import { createUserRegistry, type EmailLabel } from "../../src/domain/types.js";
import {
	EmailConfig,
	type EmailConfigService,
	SignalConfig,
	type SignalConfigService,
} from "../../src/shell/config.js";

/** Minimal SignalConfig for tests (raw object). */
function minimalSignalConfig(overrides?: Partial<SignalConfigService>): SignalConfigService {
	return {
		consumeDir: "/tmp/consume",
		emailAccountsPath: "/tmp/email-accounts.json",
		usersPath: "/tmp/users.json",
		signalApiUrl: "http://localhost:8080",
		registry: createUserRegistry([]),
		logLevel: "INFO",
		markProcessedLabel: "paperless" as EmailLabel,
		host: "127.0.0.1",
		port: 0,
		...overrides,
	};
}

/** Minimal test config for Signal pipeline. */
export function signalConfigTest(
	overrides?: Partial<SignalConfigService>,
): Layer.Layer<SignalConfig> {
	return Layer.succeed(SignalConfig)(minimalSignalConfig(overrides));
}

/** Minimal EmailConfig for tests (raw object, not a layer). */
function minimalEmailConfig(overrides?: Partial<EmailConfigService>): EmailConfigService {
	return {
		consumeDir: "/tmp/consume",
		emailAccountsPath: "/tmp/email-accounts.json",
		usersPath: "/tmp/users.json",
		signalApiUrl: "http://localhost:8080",
		registry: createUserRegistry([]),
		logLevel: "INFO",
		ollamaUrl: "http://localhost:11434",
		ollamaVisionModel: "llava",
		ollamaTextModel: "llama2",
		markProcessedLabel: "paperless" as EmailLabel,
		pageSize: 50,
		...overrides,
	};
}

/** Minimal test config for Email pipeline. */
export function emailConfigTest(overrides?: Partial<EmailConfigService>): Layer.Layer<EmailConfig> {
	return Layer.succeed(EmailConfig)(minimalEmailConfig(overrides));
}
