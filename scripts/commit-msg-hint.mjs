#!/usr/bin/env node

/**
 * Hint when branch name suggests an issue but commit body lacks Closes/Fixes.
 * Non-blocking: prints to stderr and exits 0.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const msgPath = process.argv[2];
if (!msgPath) process.exit(0);

let branch = "";
try {
	branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
} catch {
	process.exit(0);
}

const msg = fs.readFileSync(msgPath, "utf8");

// Branch patterns: fix/123, feat/42-foo, issue-123, 123-fix
const branchIssueMatch = branch.match(/(?:^|\/)(\d+)(?:-|$)/);
if (!branchIssueMatch) process.exit(0);

const issueNum = branchIssueMatch[1];
if (/Closes\s+#\d+|Fixes\s+#\d+|Resolves\s+#\d+/i.test(msg)) process.exit(0);

console.error(
	`hint: Branch suggests issue #${issueNum}. Consider adding "Closes #${issueNum}" to the commit body for fill-pr-template and auto-close.`,
);
