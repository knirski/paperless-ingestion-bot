/**
 * Auto-PR shared module. Core (pure) + shell (Effect).
 */

export {
	AutoPrOllamaConfig,
	AutoPrOllamaConfigLayer,
	CreateOrUpdatePrConfig,
	CreateOrUpdatePrConfigLayer,
	DEFAULT_OLLAMA_MODEL,
	DEFAULT_OLLAMA_URL,
} from "./config.js";
export {
	buildDescriptionPrompt,
	buildTitlePrompt,
	filterSemanticSubjects,
	firstLine,
	formatGhOutput,
	isBlank,
	isMergeCommitSubject,
	parseSubjects,
	sanitizeForGhOutput,
	trimOllamaResponse,
	validateDescriptionResponse,
	validateTitleResponse,
} from "./core.js";
export {
	AutoPrConfigError,
	formatAutoPrError,
	GhPrFailed,
	OllamaHttpError,
	ParseError,
	PrTitleBlank,
} from "./errors.js";

export {
	AutoPrPlatformLayer,
	appendGhOutput,
	ChildProcessSpawnerLayer,
	runCommand,
} from "./shell.js";
