import { Redacted } from "effect";

/** Exhaustiveness check for discriminated unions. Throws if reached. */
export function assertNever(x: never): never {
	throw new Error(`Unexpected value: ${x}`);
}

/** Redact path for logs: show basename only to avoid revealing home dir. */
export function redactPath(path: string): string {
	return path.split("/").pop() ?? path;
}

/** Redact email for logs: show domain only. */
export function redactEmail(email: string): string {
	const at = email.indexOf("@");
	return at >= 0 ? `***@${email.slice(at + 1)}` : "***";
}

/** Redact phone for logs: show last 4 digits only. */
export function redactPhone(phone: string): string {
	return phone.length >= 4 ? `***${phone.slice(-4)}` : "***";
}

/** Redact URL for logs: strip query and fragment (may contain tokens). */
export function redactUrl(url: string): string {
	const beforeQuery = url.split("?")[0] ?? url;
	const beforeFragment = beforeQuery.split("#")[0] ?? beforeQuery;
	return beforeFragment;
}

/** Wrap value for log-safe display. In formatters use r.label ?? "<redacted>". */
export function redactedForLog<T extends string>(
	value: T,
	redact: (v: T) => string,
): Redacted.Redacted<T> {
	return Redacted.make(value, { label: redact(value) });
}

/** Convert unknown to a short message for display. */
export function unknownToMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Format error for structured logs. Use formatDomainError when e is DomainError, else unknownToMessage. */
export function errorToLogMessage(
	e: unknown,
	formatDomainError: (err: { _tag: string }) => string,
): string {
	if (e && typeof e === "object" && "_tag" in e) {
		try {
			return formatDomainError(e as { _tag: string });
		} catch {
			return unknownToMessage(e);
		}
	}
	return unknownToMessage(e);
}
