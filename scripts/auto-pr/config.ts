/**
 * Config service for auto-PR scripts. Schema-validated env vars.
 */

import { Effect, Layer, Schema, ServiceMap } from "effect";
import { AutoPrConfigError } from "./errors.js";

/** Default Ollama /api/generate URL. setup-ollama runs server on localhost:11434. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434/api/generate";

/** Default Ollama model for PR title/description generation. */
export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateOrUpdatePrConfigSchema = Schema.Struct({
	branch: Schema.String,
	defaultBranch: Schema.String,
	commits: Schema.String,
	files: Schema.String,
	prTitle: Schema.String,
	descriptionFile: Schema.optional(Schema.String),
	workspace: Schema.String,
});

const AutoPrOllamaConfigSchema = Schema.Struct({
	commits: Schema.String,
	ghOutput: Schema.String,
	model: Schema.String,
	ollamaUrl: Schema.String,
	workspace: Schema.String,
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type CreateOrUpdatePrConfig = Schema.Schema.Type<typeof CreateOrUpdatePrConfigSchema>;
export type AutoPrOllamaConfig = Schema.Schema.Type<typeof AutoPrOllamaConfigSchema>;

// ─── CreateOrUpdatePrConfig service ───────────────────────────────────────────

interface CreateOrUpdatePrConfigService {
	readonly config: CreateOrUpdatePrConfig;
}

export const CreateOrUpdatePrConfig =
	ServiceMap.Service<CreateOrUpdatePrConfigService>("CreateOrUpdatePrConfig");

function buildCreateOrUpdatePrConfig(): Effect.Effect<CreateOrUpdatePrConfig, AutoPrConfigError> {
	const raw = {
		branch: process.env.BRANCH ?? "",
		defaultBranch: process.env.DEFAULT_BRANCH ?? "",
		commits: process.env.COMMITS ?? "",
		files: process.env.FILES ?? "",
		prTitle: process.env.PR_TITLE ?? "",
		descriptionFile: process.env.DESCRIPTION_FILE,
		workspace: process.env.GITHUB_WORKSPACE ?? ".",
	};
	const required: Array<[string, string]> = [
		["BRANCH", raw.branch],
		["DEFAULT_BRANCH", raw.defaultBranch],
		["COMMITS", raw.commits],
		["FILES", raw.files],
	];
	const missing = required.filter(([, v]) => !v).map(([k]) => k);
	if (missing.length > 0) {
		return Effect.fail(new AutoPrConfigError({ missing }));
	}
	return Schema.decodeUnknownEffect(CreateOrUpdatePrConfigSchema)(raw).pipe(
		Effect.mapError(() => new AutoPrConfigError({ missing })),
	);
}

export const CreateOrUpdatePrConfigLayer = Layer.effect(
	CreateOrUpdatePrConfig,
	Effect.flatMap(buildCreateOrUpdatePrConfig(), (config) =>
		Effect.succeed({ config } satisfies CreateOrUpdatePrConfigService),
	),
);

// ─── AutoPrOllamaConfig service ─────────────────────────────────────────────

interface AutoPrOllamaConfigService {
	readonly config: AutoPrOllamaConfig;
}

export const AutoPrOllamaConfig =
	ServiceMap.Service<AutoPrOllamaConfigService>("AutoPrOllamaConfig");

function buildAutoPrOllamaConfig(): Effect.Effect<AutoPrOllamaConfig, AutoPrConfigError> {
	const raw = {
		commits: process.env.COMMITS ?? "",
		ghOutput: process.env.GITHUB_OUTPUT ?? "",
		model: process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
		ollamaUrl: process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
		workspace: process.env.GITHUB_WORKSPACE ?? ".",
	};
	const required: Array<[string, string]> = [
		["COMMITS", raw.commits],
		["GITHUB_OUTPUT", raw.ghOutput],
	];
	const missing = required.filter(([, v]) => !v).map(([k]) => k);
	if (missing.length > 0) {
		return Effect.fail(new AutoPrConfigError({ missing }));
	}
	return Schema.decodeUnknownEffect(AutoPrOllamaConfigSchema)(raw).pipe(
		Effect.mapError(() => new AutoPrConfigError({ missing })),
	);
}

export const AutoPrOllamaConfigLayer = Layer.effect(
	AutoPrOllamaConfig,
	Effect.flatMap(buildAutoPrOllamaConfig(), (config) =>
		Effect.succeed({ config } satisfies AutoPrOllamaConfigService),
	),
);
