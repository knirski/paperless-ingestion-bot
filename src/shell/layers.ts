/**
 * Layer composition for paperless-ingestion-bot.
 */

import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunStdio from "@effect/platform-bun/BunStdio";
import * as BunTerminal from "@effect/platform-bun/BunTerminal";
import { Effect, Layer, Logger, type LogLevel, References } from "effect";
import * as Http from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { CredentialsStore } from "../live/credentials-store.js";
import { EmailClientLive } from "../live/imap-email-client.js";
import { OllamaClient } from "../live/ollama-client.js";
import { PaperlessClient } from "../live/paperless-client.js";
import { createSignalClient, SignalClient } from "../live/signal-client.js";
import type { LogLevel as ConfigLogLevel } from "./config.js";
import { EmailConfig, SignalConfig } from "./config.js";

/** Respect NO_COLOR (https://no-color.org): disable colors when set, for CI/scripting. */
const LoggerLayer = Logger.layer([
	Logger.consolePretty({ colors: process.env.NO_COLOR === undefined }),
]);

/** Map config log level to Effect LogLevel. */
function configLogLevelToEffect(level: ConfigLogLevel): LogLevel.LogLevel {
	switch (level) {
		case "DEBUG":
			return "Debug";
		case "INFO":
			return "Info";
		case "WARN":
			return "Warn";
		case "ERROR":
			return "Error";
		default:
			return "Info";
	}
}

const buildSignalLoggerLevelLayer = Effect.fn("buildSignalLoggerLevelLayer")(function* () {
	const cfg = yield* SignalConfig;
	const level = configLogLevelToEffect(cfg.logLevel);
	return Layer.succeed(References.MinimumLogLevel)(level);
});

/** Layer that sets minimum log level from SignalConfig. */
const SignalLoggerLevelLayer = Layer.unwrap(buildSignalLoggerLevelLayer());

const buildEmailLoggerLevelLayer = Effect.fn("buildEmailLoggerLevelLayer")(function* () {
	const cfg = yield* EmailConfig;
	const level = configLogLevelToEffect(cfg.logLevel);
	return Layer.succeed(References.MinimumLogLevel)(level);
});

/** Layer that sets minimum log level from EmailConfig. */
const EmailLoggerLevelLayer = Layer.unwrap(buildEmailLoggerLevelLayer());

export const PlatformServicesLayer = BunFileSystem.layer.pipe(Layer.provideMerge(BunPath.layer));

/** HttpClient with retry on transient errors (5 retries). */
const buildResilientClient = Effect.gen(function* () {
	const base = yield* Http.HttpClient.HttpClient;
	return base.pipe(Http.HttpClient.retryTransient({ times: 5 }));
});

const ResilientHttpClientLayer = Layer.effect(Http.HttpClient.HttpClient)(
	buildResilientClient,
).pipe(Layer.provide(Http.FetchHttpClient.layer));

/** CLI services required by effect/unstable/cli (Terminal, Stdio, ChildProcessSpawner). */
const CliLayer = BunStdio.layer.pipe(
	Layer.provideMerge(BunTerminal.layer),
	Layer.provideMerge(BunChildProcessSpawner.layer),
);

/** All layers needed to run the CLI (platform + CLI services + logger). */
export const MainLayer = PlatformServicesLayer.pipe(
	Layer.provideMerge(CliLayer.pipe(Layer.provide(PlatformServicesLayer))),
	Layer.provideMerge(LoggerLayer),
);

const buildSignalClientFromConfig = Effect.fn("buildSignalClientFromConfig")(function* () {
	const cfg = yield* SignalConfig;
	return createSignalClient(cfg.signalApiUrl);
});

/** SignalClient service built from config's signalApiUrl. */
const SignalClientFromConfig = Layer.effect(SignalClient)(buildSignalClientFromConfig());

const buildPaperlessClientFromSignalConfig = Effect.fn("buildPaperlessClientFromSignalConfig")(
	function* () {
		const cfg = yield* SignalConfig;
		return PaperlessClient.live(cfg.paperlessUrl, cfg.paperlessToken);
	},
);

/** PaperlessClient built from SignalConfig (shared base). */
const PaperlessClientFromSignalConfig = Layer.unwrap(buildPaperlessClientFromSignalConfig());

const CredentialsStoreLayer = CredentialsStore.live;

/** Type of the layer returned by buildSignalLayer. Use for buildSignalServerLayer parameter. */
export type SignalAppLayer = ReturnType<typeof buildSignalLayer>;

/** All Signal layers that depend on SignalConfig. Provide configWithPlatform once. */
const SignalConfigDependentLayers = Layer.mergeAll(
	SignalClientFromConfig,
	PaperlessClientFromSignalConfig,
	SignalLoggerLevelLayer,
);

export function buildSignalLayer(configPath: string, usersPath: string, emailAccountsPath: string) {
	const configWithPlatform = SignalConfig.layer(configPath, usersPath, emailAccountsPath).pipe(
		Layer.provideMerge(PlatformServicesLayer),
		Layer.provideMerge(ResilientHttpClientLayer),
	);
	return configWithPlatform.pipe(
		Layer.provideMerge(SignalConfigDependentLayers.pipe(Layer.provide(configWithPlatform))),
		Layer.provideMerge(CredentialsStoreLayer),
	);
}

const buildSignalClientFromEmailConfig = Effect.fn("buildSignalClientFromEmailConfig")(
	function* () {
		const cfg = yield* EmailConfig;
		return createSignalClient(cfg.signalApiUrl);
	},
);

/** SignalClient built from EmailConfig's signalApiUrl (for credential failure notifications). */
const SignalClientFromEmailConfig = Layer.effect(SignalClient)(buildSignalClientFromEmailConfig());

const buildOllamaClientFromConfig = Effect.fn("buildOllamaClientFromConfig")(function* () {
	const cfg = yield* EmailConfig;
	return OllamaClient.live(cfg.ollamaUrl);
});

/** OllamaClient built from email config. */
const OllamaClientFromConfig = Layer.unwrap(buildOllamaClientFromConfig());

/** RateLimiter with in-memory store. Use for webhook, credential failure, etc. */
export const RateLimiterMemoryLayer = RateLimiter.layer.pipe(
	Layer.provide(RateLimiter.layerStoreMemory),
);

const buildPaperlessClientFromEmailConfig = Effect.fn("buildPaperlessClientFromEmailConfig")(
	function* () {
		const cfg = yield* EmailConfig;
		return PaperlessClient.live(cfg.paperlessUrl, cfg.paperlessToken);
	},
);

/** PaperlessClient built from EmailConfig (shared base). */
const PaperlessClientFromEmailConfig = Layer.unwrap(buildPaperlessClientFromEmailConfig());

/** All Email layers that depend on EmailConfig. Provide configWithPlatform once. */
const EmailConfigDependentLayers = Layer.mergeAll(
	SignalClientFromEmailConfig,
	OllamaClientFromConfig,
	PaperlessClientFromEmailConfig,
	EmailLoggerLevelLayer,
	RateLimiterMemoryLayer,
);

export function buildEmailLayer(configPath: string, usersPath: string, emailAccountsPath: string) {
	const configWithPlatform = EmailConfig.layer(configPath, usersPath, emailAccountsPath).pipe(
		Layer.provideMerge(PlatformServicesLayer),
		Layer.provideMerge(ResilientHttpClientLayer),
	);
	return configWithPlatform.pipe(
		Layer.provideMerge(EmailClientLive),
		Layer.provideMerge(EmailConfigDependentLayers.pipe(Layer.provide(configWithPlatform))),
		Layer.provideMerge(CredentialsStoreLayer),
	);
}
