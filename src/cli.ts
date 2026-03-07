#!/usr/bin/env -S node --import tsx

/**
 * paperless-ingestion-bot: Signal and Gmail document ingestion for Paperless-ngx.
 *
 * Commands:
 *   signal [--config path]  — Run Signal webhook server
 *   email [--config path] [--json]  — Run email crawl pipeline
 */

import { createRequire } from "node:module";
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime";
import { Cause, Effect, ErrorReporter, Layer, Option } from "effect";
import * as Arr from "effect/Array";
import { Command, Flag } from "effect/unstable/cli";
import { formatErrorForStructuredLog } from "./domain/errors.js";
import { EmailConfig, resolveConfigPath } from "./shell/config.js";
import { runEmailPipeline } from "./shell/email-pipeline.js";
import { buildEmailLayer, buildSignalLayer, MainLayer } from "./shell/layers.js";
import { buildSignalServerLayer } from "./shell/signal-pipeline.js";

/** Reporter: DomainError via formatErrorForStructuredLog, defects via Cause.pretty. */
const domainErrorReporter = ErrorReporter.make(({ cause }) => {
	const firstFail = Option.getOrUndefined(Arr.findFirst(cause.reasons, Cause.isFailReason));
	const msg = firstFail ? formatErrorForStructuredLog(firstFail.error) : Cause.pretty(cause);
	process.stderr.write(`${msg}\n`);
});

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const configFlag = Flag.string("config").pipe(
	Flag.optional,
	Flag.withDescription("Path to config.json (default: /etc/paperless-ingestion-bot/config.json)"),
);

const jsonFlag = Flag.boolean("json").pipe(
	Flag.withDefault(false),
	Flag.withDescription("Output result as JSON to stdout (for scripting)"),
);

const signalCommand = Command.make("signal", { config: configFlag }, ({ config }) => {
	const configPath = resolveConfigPath(Option.getOrUndefined(config));
	const appLayer = buildSignalLayer(configPath);
	const serverLayer = buildSignalServerLayer(appLayer);
	return Layer.launch(serverLayer);
});

const runEmailCommand = Effect.fn("runEmailCommand")(function* (json: boolean) {
	yield* EmailConfig; // Validate config loads before running pipeline
	const result = yield* runEmailPipeline();
	if (json) {
		yield* Effect.sync(() => {
			process.stdout.write(`${JSON.stringify({ saved: result.saved })}\n`);
		});
	} else {
		yield* Effect.log({
			event: "cli_command",
			status: "succeeded",
			command: "email",
			saved: result.saved,
		});
	}
});

const emailCommand = Command.make(
	"email",
	{ config: configFlag, json: jsonFlag },
	({ config, json }) => {
		const configPath = resolveConfigPath(Option.getOrUndefined(config));
		const layer = buildEmailLayer(configPath);
		return runEmailCommand(json).pipe(Effect.provide(layer));
	},
);

const mainCommand = Command.make("paperless-ingestion-bot", {}, () =>
	Effect.succeed(undefined),
).pipe(Command.withSubcommands([signalCommand, emailCommand]));

const cliProgram = Command.run(mainCommand, { version: pkg.version });

export { cliProgram, mainCommand };

/* v8 ignore start - CLI entry */
if (import.meta.main) {
	// Respect POSIX signals for graceful shutdown (SIGINT/SIGTERM)
	for (const sig of ["SIGINT", "SIGTERM"] as const) {
		process.on(sig, () => {
			process.exitCode = 0;
			process.exit();
		});
	}
	NodeRuntime.runMain(
		cliProgram.pipe(
			Effect.withErrorReporting,
			Effect.provide(ErrorReporter.layer([domainErrorReporter])),
			Effect.provide(MainLayer),
		) as Effect.Effect<void, never, never>,
	);
}
/* v8 ignore stop */
