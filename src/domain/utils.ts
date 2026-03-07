/** Exhaustiveness check for discriminated unions. Throws if reached. */
export function assertNever(x: never): never {
	throw new Error(`Unexpected value: ${x}`);
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
