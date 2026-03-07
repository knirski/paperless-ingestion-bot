/** Authorization — registry lookup. */

import { Result } from "effect";
import { UnauthorizedUserError } from "../domain/errors.js";
import type { SignalNumber } from "../domain/signal-types.js";
import type { User, UserRegistry } from "../domain/types.js";
import { redactPhone, redactedForLog } from "../domain/utils.js";

export function authorizeSource(
	registry: UserRegistry,
	source: SignalNumber,
): Result.Result<User, UnauthorizedUserError> {
	const user = registry.findBySignal(source);
	if (!user) {
		return Result.fail(new UnauthorizedUserError({ source: redactedForLog(source, redactPhone) }));
	}
	return Result.succeed(user);
}
