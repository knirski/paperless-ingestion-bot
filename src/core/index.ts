/** Functional core — pure functions only, no Effect, no I/O. */

export { formatStatusMessage, upsertAccount } from "./account.js";
export { formatCredentialFailureMessage, isAuthFailure } from "./auth-failure.js";
export { authorizeSource } from "./authorization.js";
export { parseAccountCommandInput } from "./commands.js";
export { isEligibleMime, isEmailAttachmentEligible, MIN_EMAIL_IMAGE_SIZE } from "./eligibility.js";
export {
	attachmentBaseFilename,
	buildSignalAttachmentBaseFilename,
	collisionCandidateFilename,
	safeFilename,
	splitFilenameForCollision,
} from "./filename.js";
export { buildOllamaRequest, parseOllamaYesNo } from "./ollama.js";
export { buildSearch, emailToSlug, mergeExcludeLabels } from "./search.js";
export { validateAddGmailAccountInput, validateAppPassword, validateEmail } from "./validation.js";
