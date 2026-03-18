import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, Option, Redacted } from "effect";
import * as fc from "fast-check";
import type { Account } from "../src/domain/account.js";
import { resolveImapConfig } from "../src/domain/imap-provider.js";
import type { AccountEmail, EmailLabel, UserSlug } from "../src/domain/types.js";
import { PlatformServicesLayer } from "../src/shell/layers.js";
import {
	accountFromMetadata,
	accountToSerializable,
	atomicWriteJson,
	loadAllAccounts,
	saveAllAccounts,
} from "../src/shell/runtime.js";
import {
	createTestTempDir,
	credentialsStoreTest,
	joinPath,
	readTestFile,
	SilentLoggerLayer,
	writeTestFile,
} from "./test-utils.js";

describe("atomicWriteJson", () => {
	test.each([
		{ data: {}, desc: "empty object" },
		{ data: { a: 1, b: "x" }, desc: "object with primitives" },
		{ data: { nested: { deep: true } }, desc: "nested object" },
		{ data: { arr: [1, 2, 3] }, desc: "object with array" },
	])("writes $desc atomically", async ({ data }) => {
		const tmp = await createTestTempDir();
		const path = tmp.join("data.json");

		const program = atomicWriteJson(path, data).pipe(
			Effect.provide(PlatformServicesLayer),
			Effect.provide(SilentLoggerLayer),
		);
		await Effect.runPromise(program);

		const content = await readTestFile(path, "utf-8");
		expect(JSON.parse(content as string)).toEqual(data);
		// No .tmp file left behind
		await expect(readTestFile(`${path}.tmp`, "utf-8")).rejects.toThrow();
		await tmp.remove();
	});

	test("PBT: any JSON-serializable object round-trips", async () => {
		const arb = fc.record({
			a: fc.integer(),
			b: fc.string(),
			c: fc.boolean(),
			d: fc.option(fc.array(fc.integer())),
		});
		await fc.assert(
			fc.asyncProperty(arb, async (data) => {
				const tmp = await createTestTempDir();
				const path = tmp.join("data.json");
				const program = atomicWriteJson(path, data).pipe(
					Effect.provide(PlatformServicesLayer),
					Effect.provide(SilentLoggerLayer),
				);
				await Effect.runPromise(program);
				const content = await readTestFile(path, "utf-8");
				expect(JSON.parse(content as string)).toEqual(data);
				await tmp.remove();
			}),
		);
	});
});

describe("accountToSerializable", () => {
	test.each([
		{
			desc: "active account",
			account: {
				email: "a@example.com" as AccountEmail,
				appPassword: Redacted.make("x"),
				_tag: "active" as const,
				excludeLabels: [] as EmailLabel[],
				imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
				addedBy: "u1" as UserSlug,
			},
			expected: { enabled: true, removed: false },
		},
		{
			desc: "paused account",
			account: {
				email: "b@example.com" as AccountEmail,
				appPassword: Redacted.make("y"),
				_tag: "paused" as const,
				excludeLabels: ["SPAM" as EmailLabel],
				imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
				addedBy: "u2" as UserSlug,
			},
			expected: { enabled: false, removed: false },
		},
		{
			desc: "removed account",
			account: {
				email: "c@example.com" as AccountEmail,
				appPassword: Redacted.make("z"),
				_tag: "removed" as const,
				excludeLabels: [] as EmailLabel[],
				imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
				addedBy: "u3" as UserSlug,
			},
			expected: { enabled: false, removed: true },
		},
		{
			desc: "generic IMAP includes host/port in details",
			account: {
				email: "d@example.com" as AccountEmail,
				appPassword: Redacted.make("w"),
				_tag: "active" as const,
				excludeLabels: [] as EmailLabel[],
				imapConfig: resolveImapConfig("generic", "paperless" as EmailLabel, {
					host: "imap.example.com",
					port: 993,
					secure: true,
					mailbox: "INBOX",
				}),
				addedBy: "u4" as UserSlug,
			},
			expected: {
				details: {
					type: "generic_imap",
					host: "imap.example.com",
					port: 993,
					secure: true,
					mailbox: "INBOX",
				},
			},
		},
	])("$desc", ({ account, expected }) => {
		const out = accountToSerializable(account);
		expect(out).toMatchObject(expected);
		expect(out.email).toBe(account.email);
		expect(out.exclude_labels).toEqual(account.excludeLabels);
		expect(out.added_by).toBe(account.addedBy);
	});

	test("PBT: serializable shape is JSON-safe", () => {
		const detailsArb = fc.oneof(
			fc.constant({ type: "gmail" } as const),
			fc.record({
				type: fc.constant("generic_imap"),
				host: fc.constant("imap.example.com"),
				port: fc.constant(993),
				secure: fc.constant(true),
				mailbox: fc.constant("INBOX"),
			}),
		);
		const arb = fc.record({
			email: fc.emailAddress(),
			enabled: fc.boolean(),
			removed: fc.boolean(),
			exclude_labels: fc.array(fc.string()),
			added_by: fc.string(),
			details: detailsArb,
		});
		fc.assert(
			fc.property(arb, (base) => {
				const account: Account = {
					email: base.email as AccountEmail,
					appPassword: Redacted.make("x".repeat(16)),
					_tag: base.removed
						? ("removed" as const)
						: base.enabled
							? ("active" as const)
							: ("paused" as const),
					excludeLabels: base.exclude_labels as EmailLabel[],
					imapConfig:
						base.details.type === "gmail"
							? resolveImapConfig("gmail", "paperless" as EmailLabel)
							: resolveImapConfig("generic", "paperless" as EmailLabel, {
									host: base.details.host,
									port: base.details.port,
									secure: base.details.secure,
									mailbox: base.details.mailbox,
								}),
					addedBy: base.added_by as UserSlug,
				};
				const out = accountToSerializable(account);
				expect(JSON.parse(JSON.stringify(out))).toEqual(out);
			}),
		);
	});
});

describe("accountFromMetadata", () => {
	test.each([
		{
			desc: "valid gmail metadata",
			obj: {
				email: "valid@example.com",
				enabled: true,
				removed: false,
				exclude_labels: [],
				added_by: "user1" as UserSlug,
				details: { type: "gmail" } as const,
			},
			expectedTag: "active",
		},
		{
			desc: "paused metadata",
			obj: {
				email: "paused@example.com",
				enabled: false,
				removed: false,
				exclude_labels: ["SPAM" as EmailLabel],
				added_by: "user1" as UserSlug,
				details: { type: "gmail" } as const,
			},
			expectedTag: "paused",
		},
		{
			desc: "removed metadata",
			obj: {
				email: "removed@example.com",
				enabled: false,
				removed: true,
				exclude_labels: [],
				added_by: "user1" as UserSlug,
				details: { type: "gmail" } as const,
			},
			expectedTag: "removed",
		},
		{
			desc: "valid generic_imap metadata",
			obj: {
				email: "generic@example.com",
				enabled: true,
				removed: false,
				exclude_labels: [],
				added_by: "user1" as UserSlug,
				details: {
					type: "generic_imap" as const,
					host: "imap.example.com",
					port: 993,
					secure: true,
					mailbox: "INBOX",
				},
			},
			expectedTag: "active",
		},
	])("$desc", async ({ obj, expectedTag }) => {
		const program = accountFromMetadata(
			obj,
			"/tmp/creds.json",
			"paperless" as EmailLabel,
			Redacted.make("password16chars!!"),
		).pipe(Effect.provide(SilentLoggerLayer));
		const acc = await Effect.runPromise(program);
		expect(acc._tag).toBe(expectedTag);
		expect(acc.email).toBe(obj.email as import("../src/domain/types.js").AccountEmail);
		expect(acc.excludeLabels).toEqual(obj.exclude_labels);
		expect(acc.addedBy).toBe(obj.added_by);
	});

	test("invalid email fails with ConfigParseError", async () => {
		const program = accountFromMetadata(
			{
				email: "not-an-email",
				enabled: true,
				removed: false,
				exclude_labels: [] as EmailLabel[],
				added_by: "user1" as UserSlug,
				details: { type: "gmail" } as const,
			},
			"/tmp/creds.json",
			"paperless" as EmailLabel,
			Redacted.make("x".repeat(16)),
		).pipe(Effect.provide(SilentLoggerLayer));
		const exit = await Effect.runPromise(Effect.exit(program));
		expect(Exit.isFailure(exit)).toBe(true);
		const err = Exit.findErrorOption(exit);
		expect(Option.isSome(err)).toBe(true);
		if (Option.isSome(err)) {
			expect(err.value).toMatchObject({ _tag: "ConfigParseError" });
		}
	});
});

describe("loadAllAccounts", () => {
	test.each([
		{
			desc: "missing file returns []",
			setup: async (_dir: string) => {},
			passwords: {},
			expectedCount: 0,
		},
		{
			desc: "empty array returns []",
			setup: async (dir: string) => {
				await writeTestFile(await joinPath(dir, "creds.json"), "[]");
			},
			passwords: {},
			expectedCount: 0,
		},
		{
			desc: "invalid JSON fails with ConfigParseError",
			setup: async (dir: string) => {
				await writeTestFile(await joinPath(dir, "creds.json"), "not json");
			},
			passwords: {},
			expectError: true,
		},
		{
			desc: "non-array valid JSON fails with ConfigParseError",
			setup: async (dir: string) => {
				await writeTestFile(await joinPath(dir, "creds.json"), '{"a":1}');
			},
			passwords: {},
			expectError: true,
		},
		{
			desc: "invalid schema entry fails parse with ConfigParseError",
			setup: async (dir: string) => {
				await writeTestFile(
					await joinPath(dir, "creds.json"),
					JSON.stringify([
						{
							email: "a@example.com",
							enabled: true,
							removed: false,
							exclude_labels: [],
							added_by: "user1",
							details: { type: "gmail" },
						},
						{ bad: "entry" },
						{
							email: "b@example.com",
							enabled: false,
							removed: false,
							exclude_labels: ["SPAM"],
							added_by: "user1",
							details: { type: "gmail" },
						},
					]),
				);
			},
			passwords: { "a@example.com": "abcdefghijklmnop", "b@example.com": "abcdefghijklmnop" },
			expectError: true,
		},
		{
			desc: "valid entry with password returns account",
			setup: async (dir: string) => {
				await writeTestFile(
					await joinPath(dir, "creds.json"),
					JSON.stringify([
						{
							email: "a@example.com",
							enabled: true,
							removed: false,
							exclude_labels: [],
							added_by: "user1",
							details: { type: "gmail" },
						},
					]),
				);
			},
			passwords: { "a@example.com": "abcdefghijklmnop" },
			expectedCount: 1,
		},
		{
			desc: "entry without password in store is filtered out",
			setup: async (dir: string) => {
				await writeTestFile(
					await joinPath(dir, "creds.json"),
					JSON.stringify([
						{
							email: "nopass@example.com",
							enabled: true,
							removed: false,
							exclude_labels: [],
							added_by: "user1",
							details: { type: "gmail" },
						},
					]),
				);
			},
			passwords: {},
			expectedCount: 0,
		},
		{
			desc: "multiple accounts with passwords",
			setup: async (dir: string) => {
				await writeTestFile(
					await joinPath(dir, "creds.json"),
					JSON.stringify([
						{
							email: "a@example.com",
							enabled: true,
							removed: false,
							exclude_labels: [],
							added_by: "user1",
							details: { type: "gmail" },
						},
						{
							email: "b@example.com",
							enabled: false,
							removed: false,
							exclude_labels: ["SPAM"],
							added_by: "user1",
							details: { type: "gmail" },
						},
					]),
				);
			},
			passwords: { "a@example.com": "pass16charsxxxxxx", "b@example.com": "pass16charsyyyyyy" },
			expectedCount: 2,
		},
		{
			desc: "generic_imap entry with password loads",
			setup: async (dir: string) => {
				await writeTestFile(
					await joinPath(dir, "creds.json"),
					JSON.stringify([
						{
							email: "generic@example.com",
							enabled: true,
							removed: false,
							exclude_labels: [],
							added_by: "user1",
							details: {
								type: "generic_imap",
								host: "imap.example.com",
								port: 993,
								secure: true,
								mailbox: "INBOX",
							},
						},
					]),
				);
			},
			passwords: { "generic@example.com": "pass16charsxxxxxx" },
			expectedCount: 1,
		},
	])("$desc", async ({ setup, passwords, expectedCount = 0, expectError = false }) => {
		const tmp = await createTestTempDir();
		const credentialsPath = tmp.join("creds.json");
		await setup(tmp.path);

		const layer = Layer.mergeAll(
			PlatformServicesLayer,
			credentialsStoreTest(passwords),
			SilentLoggerLayer,
		);
		const program = loadAllAccounts(credentialsPath).pipe(Effect.provide(layer)) as Effect.Effect<
			Account[],
			never,
			never
		>;

		if (expectError) {
			const exit = await Effect.runPromise(Effect.exit(program));
			expect(Exit.isFailure(exit)).toBe(true);
			const err = Exit.findErrorOption(exit);
			expect(Option.isSome(err)).toBe(true);
			if (Option.isSome(err)) {
				expect(err.value).toMatchObject({ _tag: "ConfigParseError" });
			}
		} else {
			const result = await Effect.runPromise(program);
			expect(result).toHaveLength(expectedCount);
			if (expectedCount > 0) {
				expect(result[0]).toHaveProperty("email");
				expect(result[0]).toHaveProperty("appPassword");
			}
		}
		await tmp.remove();
	});

	test("PBT: N valid entries with passwords yields N accounts", async () => {
		const n = fc.integer({ min: 0, max: 5 });
		await fc.assert(
			fc.asyncProperty(n, async (count) => {
				const tmp = await createTestTempDir();
				const credentialsPath = tmp.join("creds.json");

				const entries = Array.from({ length: count }, (_, i) => ({
					email: `user${i}@example.com`,
					enabled: true,
					removed: false,
					exclude_labels: [] as string[],
					added_by: "user1",
					details: { type: "gmail" } as const,
				}));
				const passwords = Object.fromEntries(entries.map((e) => [e.email, "a".repeat(16)]));
				await tmp.writeFile(credentialsPath, JSON.stringify(entries));

				const layer = Layer.mergeAll(
					PlatformServicesLayer,
					credentialsStoreTest(passwords),
					SilentLoggerLayer,
				);
				const program = loadAllAccounts(credentialsPath).pipe(
					Effect.provide(layer),
				) as Effect.Effect<Account[], never, never>;
				const result = await Effect.runPromise(program);

				expect(result).toHaveLength(count);
				await tmp.remove();
			}),
		);
	});
});

describe("saveAllAccounts", () => {
	test.each([
		{ count: 0, desc: "empty accounts" },
		{ count: 1, desc: "single account" },
		{ count: 3, desc: "multiple accounts" },
	])("$desc writes valid JSON and calls setPassword", async ({ count }) => {
		const tmp = await createTestTempDir();
		const credentialsPath = tmp.join("creds.json");

		const accounts: Account[] = Array.from({ length: count }, (_, i) => ({
			email: `save${i}@example.com` as AccountEmail,
			appPassword: Redacted.make("pass16charsxxxxxx"),
			_tag: "active" as const,
			excludeLabels: [] as EmailLabel[],
			imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
			addedBy: "user1" as UserSlug,
		}));
		const passwords = Object.fromEntries(accounts.map((a) => [a.email, "pass16charsxxxxxx"]));

		const layer = Layer.mergeAll(
			PlatformServicesLayer,
			credentialsStoreTest(passwords),
			SilentLoggerLayer,
		);
		const program = saveAllAccounts(credentialsPath, accounts).pipe(
			Effect.provide(layer),
		) as Effect.Effect<void, never, never>;
		await Effect.runPromise(program);

		const content = await readTestFile(credentialsPath, "utf-8");
		const parsed = JSON.parse(content as string);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(count);
		for (let i = 0; i < count; i++) {
			expect(parsed[i]).toMatchObject({
				email: `save${i}@example.com`,
				enabled: true,
				removed: false,
				exclude_labels: [],
			});
		}
		await tmp.remove();
	});

	test("save then load round-trips (Gmail)", async () => {
		const tmp = await createTestTempDir();
		const credentialsPath = tmp.join("creds.json");

		const accounts: Account[] = [
			{
				email: "roundtrip@example.com" as AccountEmail,
				appPassword: Redacted.make("roundtrip16chars!!"),
				_tag: "active" as const,
				excludeLabels: ["SPAM" as EmailLabel, "Archived" as EmailLabel],
				imapConfig: resolveImapConfig("gmail", "paperless" as EmailLabel),
				addedBy: "user1" as UserSlug,
			},
		];
		const store = credentialsStoreTest({ "roundtrip@example.com": "roundtrip16chars!!" });

		const layer = Layer.mergeAll(PlatformServicesLayer, store, SilentLoggerLayer);
		await Effect.runPromise(
			saveAllAccounts(credentialsPath, accounts).pipe(Effect.provide(layer)) as Effect.Effect<
				void,
				never,
				never
			>,
		);
		const loaded = await Effect.runPromise(
			loadAllAccounts(credentialsPath).pipe(Effect.provide(layer)) as Effect.Effect<
				Account[],
				never,
				never
			>,
		);

		expect(loaded).toHaveLength(1);
		const acc = loaded[0];
		expect(acc).toBeDefined();
		expect(acc?.email).toBe(
			"roundtrip@example.com" as import("../src/domain/types.js").AccountEmail,
		);
		if (acc) expect(Redacted.value(acc.appPassword)).toBe("roundtrip16chars!!");
		expect(acc?.excludeLabels).toEqual([
			"SPAM",
			"Archived",
		] as unknown as readonly import("../src/domain/types.js").EmailLabel[]);
		await tmp.remove();
	});

	test("save then load round-trips (generic_imap)", async () => {
		const tmp = await createTestTempDir();
		const credentialsPath = tmp.join("creds.json");

		const accounts: Account[] = [
			{
				email: "generic@example.com" as AccountEmail,
				appPassword: Redacted.make("roundtrip16chars!!"),
				_tag: "active" as const,
				excludeLabels: [] as EmailLabel[],
				imapConfig: resolveImapConfig("generic", "paperless" as EmailLabel, {
					host: "imap.example.com",
					port: 143,
					secure: false,
					mailbox: "Archive",
				}),
				addedBy: "user1" as UserSlug,
			},
		];
		const store = credentialsStoreTest({ "generic@example.com": "roundtrip16chars!!" });

		const layer = Layer.mergeAll(PlatformServicesLayer, store, SilentLoggerLayer);
		await Effect.runPromise(
			saveAllAccounts(credentialsPath, accounts).pipe(Effect.provide(layer)) as Effect.Effect<
				void,
				never,
				never
			>,
		);
		const loaded = await Effect.runPromise(
			loadAllAccounts(credentialsPath).pipe(Effect.provide(layer)) as Effect.Effect<
				Account[],
				never,
				never
			>,
		);

		expect(loaded).toHaveLength(1);
		const acc = loaded[0];
		expect(acc).toBeDefined();
		expect(acc?.email).toBe("generic@example.com" as import("../src/domain/types.js").AccountEmail);
		if (acc) expect(Redacted.value(acc.appPassword)).toBe("roundtrip16chars!!");
		expect(acc?.imapConfig.provider).toBe("generic");
		expect(acc?.imapConfig.host).toBe("imap.example.com");
		expect(acc?.imapConfig.port).toBe(143);
		expect(acc?.imapConfig.secure).toBe(false);
		expect(acc?.imapConfig.mailbox).toBe("Archive");
		await tmp.remove();
	});
});
