/** Email and password validation. */

import { Result } from "effect";
import { AppPasswordTooShortError, InvalidEmailError } from "../domain/errors.js";
import { redactEmail, redactedForLog } from "../domain/utils.js";

const EMAIL_PATTERN = /^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/;
const APP_PASSWORD_MIN_LEN = 16;

export function validateEmail(email: string): Result.Result<string, InvalidEmailError> {
	const trimmed = email.trim();
	if (!EMAIL_PATTERN.test(trimmed)) {
		return Result.fail(new InvalidEmailError({ email: redactedForLog(email, redactEmail) }));
	}
	return Result.succeed(trimmed);
}

export function validateAppPassword(
	password: string,
): Result.Result<string, AppPasswordTooShortError> {
	const normalized = password.trim().replace(/\s/g, "");
	if (normalized.length < APP_PASSWORD_MIN_LEN) {
		return Result.fail(
			new AppPasswordTooShortError({
				message: `App password must be at least ${APP_PASSWORD_MIN_LEN} characters`,
			}),
		);
	}
	return Result.succeed(normalized);
}

const ADD_GMAIL_ACCOUNT_EMAIL_ERROR = `❌ Invalid email format.\n\nUse a valid address like user@example.com`;

const ADD_GMAIL_ACCOUNT_PASSWORD_ERROR =
	`❌ App password too short (need 16+ chars).\n\n` +
	`Get one at: Google Account > Security > 2-Step Verification > App passwords`;

/** Validate add Gmail account input; returns user-facing error message on failure. */
export function validateAddGmailAccountInput(
	email: string,
	password: string,
): Result.Result<{ email: string; password: string }, string> {
	const emailResult = validateEmail(email);
	if (Result.isFailure(emailResult)) return Result.fail(ADD_GMAIL_ACCOUNT_EMAIL_ERROR);

	const pwResult = validateAppPassword(password);
	if (Result.isFailure(pwResult)) return Result.fail(ADD_GMAIL_ACCOUNT_PASSWORD_ERROR);

	return Result.succeed({
		email: emailResult.success,
		password: pwResult.success,
	});
}
