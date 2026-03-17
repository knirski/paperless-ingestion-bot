import { test } from "bun:test";
import { createTestTempDir, joinPath, writeTestFile } from "../test-utils.js";

/** Account metadata for email-accounts.json. */
interface AccountMetadata {
	email: string;
	enabled: boolean;
	removed: boolean;
	exclude_labels: readonly string[];
	added_by: string;
	details:
		| { type: "gmail" }
		| { type: "generic_imap"; host: string; port: number; secure: boolean; mailbox: string };
}

/** Write accounts to tmpDir and return path. Use for multi-account tests. */
export async function writeAccountsFile(
	tmpDir: string,
	accounts: readonly AccountMetadata[],
): Promise<string> {
	const path = await joinPath(tmpDir, "email-accounts.json");
	await writeTestFile(path, JSON.stringify(accounts));
	return path;
}

export const DEFAULT_ACCOUNT = {
	email: "test@example.com",
	enabled: true,
	removed: false,
	exclude_labels: [] as string[],
	added_by: "user1",
	details: { type: "gmail" } as const,
};

export interface IntegrationFixture {
	tmpDir: string;
	emailAccountsPath: string;
}

/** Bun-compatible replacement for Vitest test.extend. Sets up tmpDir and emailAccountsPath, runs fn, then cleans up. */
export function integrationTest(
	name: string,
	fn: (fixture: IntegrationFixture) => Promise<void> | void,
): void {
	test(name, async () => {
		const tmp = await createTestTempDir("ingestion-integration-");
		try {
			const emailAccountsPath = await joinPath(tmp.path, "email-accounts.json");
			await writeTestFile(emailAccountsPath, JSON.stringify([DEFAULT_ACCOUNT]));
			await fn({ tmpDir: tmp.path, emailAccountsPath });
		} finally {
			await tmp.remove();
		}
	});
}
