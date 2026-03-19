/**
 * Layer composition for paperless-ingestion-bot.
 */

import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import { Effect, Layer, Logger, type LogLevel, References } from "effect";
import * as Http from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { CredentialsStore } from "../live/credentials-store.js";
import { EmailClientLive } from "../live/imap-email-client.js";
import { OllamaClient } from "../live/ollama-client.js";
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

export const PlatformServicesLayer = NodeFileSystem.layer.pipe(Layer.provideMerge(NodePath.layer));

/** CLI services required by effect/unstable/cli (Terminal, Stdio, ChildProcessSpawner). */
const CliLayer = NodeStdio.layer.pipe(
	Layer.provideMerge(NodeTerminal.layer),
	Layer.provideMerge(NodeChildProcessSpawner.layer),
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

const CredentialsStoreLayer = CredentialsStore.live;

/** Type of the layer returned by buildSignalLayer. Use for buildSignalServerLayer parameter. */
export type SignalAppLayer = ReturnType<typeof buildSignalLayer>;

/** All Signal layers that depend on SignalConfig. Provide configWithPlatform once. */
const SignalConfigDependentLayers = Layer.mergeAll(SignalClientFromConfig, SignalLoggerLevelLayer);

export function buildSignalLayer(configPath: string, usersPath: string, emailAccountsPath: string) {
	const configWithPlatform = SignalConfig.layer(configPath, usersPath, emailAccountsPath).pipe(
		Layer.provideMerge(PlatformServicesLayer),
		Layer.provideMerge(Http.FetchHttpClient.layer),
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

/** All Email layers that depend on EmailConfig. Provide configWithPlatform once. */
const EmailConfigDependentLayers = Layer.mergeAll(
	SignalClientFromEmailConfig,
	OllamaClientFromConfig,
	EmailLoggerLevelLayer,
	RateLimiterMemoryLayer,
);

export function buildEmailLayer(configPath: string, usersPath: string, emailAccountsPath: string) {
	const configWithPlatform = EmailConfig.layer(configPath, usersPath, emailAccountsPath).pipe(
		Layer.provideMerge(PlatformServicesLayer),
		Layer.provideMerge(Http.FetchHttpClient.layer),
	);
	return configWithPlatform.pipe(
		Layer.provideMerge(EmailClientLive),
		Layer.provideMerge(EmailConfigDependentLayers.pipe(Layer.provide(configWithPlatform))),
		Layer.provideMerge(CredentialsStoreLayer),
	);
}
