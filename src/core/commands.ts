/** Command ADT and parsing. AddGmailAccountCommand is Gmail-specific; others control ingestion. */

import { Option, Result, Schema } from "effect";
import { type AccountEmail, AccountEmailSchema } from "../domain/types.js";
import { validateEmail } from "./validation.js";

const GMAIL_ADD_PATTERN = /gmail\s+add\s+(\S+@\S+)\s+(.+)/i;
const GMAIL_CMD_PATTERN = /gmail\s+(pause|resume|status|remove)\s*(?:(\S+@\S+))?\s*$/i;

interface AddGmailAccountCommand {
	readonly _tag: "AddGmailAccountCommand";
	readonly rawEmail: string;
	readonly rawPassword: string;
}

interface PauseIngestionCommand {
	readonly _tag: "PauseIngestionCommand";
	readonly email: AccountEmail;
}

interface ResumeIngestionCommand {
	readonly _tag: "ResumeIngestionCommand";
	readonly email: AccountEmail;
}

interface RemoveAccountCommand {
	readonly _tag: "RemoveAccountCommand";
	readonly email: AccountEmail;
}

interface StatusIngestionCommand {
	readonly _tag: "StatusIngestionCommand";
}

type Command =
	| AddGmailAccountCommand
	| PauseIngestionCommand
	| ResumeIngestionCommand
	| RemoveAccountCommand
	| StatusIngestionCommand;

export function parseAccountCommandInput(body: string): Option.Option<Command> {
	const stripped = body.trim();

	const addMatch = stripped.match(GMAIL_ADD_PATTERN);
	if (addMatch) {
		return Option.some({
			_tag: "AddGmailAccountCommand",
			rawEmail: (addMatch[1] ?? "").trim(),
			rawPassword: addMatch[2] ?? "",
		});
	}

	const cmdMatch = stripped.match(GMAIL_CMD_PATTERN);
	if (!cmdMatch) return Option.none();

	const command = (cmdMatch[1] ?? "").toLowerCase();
	const emailArg = cmdMatch[2]?.trim();

	if (command === "status") return Option.some({ _tag: "StatusIngestionCommand" });
	if (emailArg) {
		const emailResult = validateEmail(emailArg);
		if (Result.isSuccess(emailResult)) {
			const email = Schema.decodeSync(AccountEmailSchema)(emailResult.success);
			if (command === "pause") return Option.some({ _tag: "PauseIngestionCommand", email });
			if (command === "resume") return Option.some({ _tag: "ResumeIngestionCommand", email });
			if (command === "remove") return Option.some({ _tag: "RemoveAccountCommand", email });
		}
	}
	return Option.none();
}
