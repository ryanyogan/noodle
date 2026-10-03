import { describe, expect, it, vi } from "vitest";
import {
	BackupConfigError,
	backupAlertEmail,
	backupKeys,
	buildManifest,
	checkNight,
	exportConfig,
	noteBackupStored,
	noteConfigMissing,
	previousNightKeys,
	readBackupState,
	runExport,
	tablesInDump,
	verifyBackup,
} from "./backup";

const CONFIG = { accountId: "acct", databaseId: "db", token: "secret-token" };

function answer(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function streamOf(...chunks: string[]) {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

describe("backupKeys", () => {
	it("puts a night under d1/YYYY/MM/DD", () => {
		expect(backupKeys(new Date("2026-10-03T09:00:00Z"))).toEqual({
			date: "2026-10-03",
			dump: "d1/2026/10/03.sql",
			manifest: "d1/2026/10/03.json",
			monthlyDump: null,
			monthlyManifest: null,
		});
	});

	it("keeps a monthly copy on the 1st", () => {
		const keys = backupKeys(new Date("2026-11-01T09:00:00Z"));
		expect(keys.monthlyDump).toBe("d1/monthly/2026-11.sql");
		expect(keys.monthlyManifest).toBe("d1/monthly/2026-11.json");
	});

	it("looks for the night before for the missed-night check", () => {
		expect(previousNightKeys(new Date("2026-11-01T09:00:00Z")).manifest).toBe("d1/2026/10/31.json");
	});
});

describe("buildManifest", () => {
	it("records size, bookmark, migration, rows and duration", () => {
		const manifest = buildManifest({
			date: "2026-10-03",
			dump: "d1/2026/10/03.sql",
			bytes: 1234,
			bookmark: "0000012b",
			migration: "0044_rule_commitments.sql",
			tables: { households: 1, transactions: 42 },
			startedAt: Date.parse("2026-10-03T09:00:00Z"),
			finishedAt: Date.parse("2026-10-03T09:00:07.5Z"),
		});
		expect(manifest).toEqual({
			date: "2026-10-03",
			dump: "d1/2026/10/03.sql",
			bytes: 1234,
			bookmark: "0000012b",
			migration: "0044_rule_commitments.sql",
			tables: { households: 1, transactions: 42 },
			startedAt: "2026-10-03T09:00:00.000Z",
			durationMs: 7500,
		});
	});
});

describe("verifyBackup", () => {
	const live = ["households", "transactions", "_cf_KV"];

	it("passes a non-empty dump with every table", () => {
		expect(verifyBackup({ bytes: 10 }, live, new Set(["households", "transactions"]))).toEqual([]);
	});

	it("fails a missing or empty dump", () => {
		expect(verifyBackup(null, live, new Set())).toEqual(["The dump isn’t in noodle-backups."]);
		expect(verifyBackup({ bytes: 0 }, live, new Set())).toEqual(["The dump is empty."]);
	});

	it("names tables the dump lacks", () => {
		expect(verifyBackup({ bytes: 10 }, live, new Set(["households"]))).toEqual([
			"The dump has no CREATE TABLE for: transactions.",
		]);
	});
});

describe("tablesInDump", () => {
	it("finds CREATE TABLE lines, even split across chunks", async () => {
		const tables = await tablesInDump(
			streamOf(
				"PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE d1_migrations(id INTEGER);\nINSERT INTO",
				' "d1_migrations" VALUES(1);\nCREATE TA',
				'BLE IF NOT EXISTS "transactions" (`id` text);\nCREATE TABLE `households` (x)',
			),
		);
		expect([...tables].sort()).toEqual(["d1_migrations", "households", "transactions"]);
	});
});

describe("exportConfig", () => {
	it("names what's missing", () => {
		expect(() => exportConfig({ BACKUP_ACCOUNT_ID: "acct" })).toThrow(
			new BackupConfigError(
				"The backup isn’t set up: BACKUP_DATABASE_ID, D1_EXPORT_TOKEN missing.",
			),
		);
	});

	it("reads all three", () => {
		expect(
			exportConfig({ BACKUP_ACCOUNT_ID: "acct", BACKUP_DATABASE_ID: "db", D1_EXPORT_TOKEN: "t" }),
		).toEqual({ accountId: "acct", databaseId: "db", token: "t" });
	});
});

describe("runExport", () => {
	it("starts an export, polls with the bookmark, and returns the signed URL", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(
				answer({ success: true, result: { at_bookmark: "bm-1", status: "active" } }),
			)
			.mockResolvedValueOnce(
				answer({
					success: true,
					result: {
						at_bookmark: "bm-1",
						status: "complete",
						result: { filename: "noodle.sql", signed_url: "https://signed.example/dump" },
					},
				}),
			);
		const wait = vi.fn(async () => undefined);
		const ready = await runExport(CONFIG, { fetch, wait });
		expect(ready).toEqual({
			signedUrl: "https://signed.example/dump",
			bookmark: "bm-1",
			filename: "noodle.sql",
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db/export");
		expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-token" });
		expect(JSON.parse(String(init?.body))).toEqual({ output_format: "polling" });
		expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
			output_format: "polling",
			current_bookmark: "bm-1",
		});
		expect(wait).toHaveBeenCalledTimes(1);
	});

	it("fails clearly when the API refuses the token", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(
				answer({ success: false, errors: [{ message: "Authentication error" }] }, 403),
			);
		await expect(runExport(CONFIG, { fetch, wait: async () => undefined })).rejects.toThrow(
			"The D1 export API refused: Authentication error",
		);
	});

	it("fails when the export errors or never finishes", async () => {
		const failing = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(answer({ success: true, result: { status: "error", error: "boom" } }));
		await expect(
			runExport(CONFIG, { fetch: failing, wait: async () => undefined }),
		).rejects.toThrow("The D1 export failed: boom");
		const slow = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => answer({ success: true, result: { status: "active" } }));
		await expect(
			runExport(CONFIG, { fetch: slow, wait: async () => undefined, maxPolls: 3 }),
		).rejects.toThrow("didn’t finish in time");
		expect(slow).toHaveBeenCalledTimes(3);
	});
});

describe("backupAlertEmail", () => {
	it("says which night and why, escaped in HTML", () => {
		const email = backupAlertEmail("2026-10-03", ["The dump <x> is empty."]);
		expect(email.subject).toBe("Noodle’s database backup for 2026-10-03 didn’t work");
		expect(email.text).toContain("- The dump <x> is empty.");
		expect(email.html).toContain("The dump &lt;x&gt; is empty.");
	});
});

function fakeBucket() {
	const objects = new Map<string, string>();
	return {
		objects,
		head: async (key: string) => (objects.has(key) ? { key } : null),
		get: async (key: string) => {
			const value = objects.get(key);
			return value === undefined ? null : { text: async () => value };
		},
		put: async (key: string, value: string) => {
			objects.set(key, value);
			return {};
		},
	};
}

const MISSING = "The backup isn’t set up: D1_EXPORT_TOKEN missing.";

describe("a missing export token", () => {
	it("emails the first night, then only logs", async () => {
		const bucket = fakeBucket();
		const alert = vi.fn(async (_date: string, _problems: string[]) => undefined);
		await noteConfigMissing(bucket, "2026-10-03", MISSING, alert);
		expect(alert).toHaveBeenCalledTimes(1);
		expect(alert.mock.calls[0]?.[0]).toBe("2026-10-03");
		expect(alert.mock.calls[0]?.[1]).toContain(MISSING);

		await noteConfigMissing(bucket, "2026-10-04", MISSING, alert);
		expect(alert).toHaveBeenCalledTimes(1);
		expect(await readBackupState(bucket)).toEqual({
			settingMissingAlerted: true,
			settingMissingThrough: "2026-10-04",
		});
		expect([...bucket.objects.keys()]).toEqual(["state/backup.json"]);
	});

	it("emails again after a backup is stored and it goes missing again", async () => {
		const bucket = fakeBucket();
		const alert = vi.fn(async (_date: string, _problems: string[]) => undefined);
		await noteConfigMissing(bucket, "2026-10-03", MISSING, alert);
		await noteBackupStored(bucket);
		expect((await readBackupState(bucket)).settingMissingAlerted).toBe(false);
		await noteConfigMissing(bucket, "2026-10-10", MISSING, alert);
		expect(alert).toHaveBeenCalledTimes(2);
	});

	it("isn't reported as missed nights, while missing or once it's set", async () => {
		const bucket = fakeBucket();
		const alert = vi.fn(async (_date: string, _problems: string[]) => undefined);
		// Nights of the 3rd and 4th ran without the token (one email).
		await noteConfigMissing(bucket, "2026-10-03", MISSING, alert);
		await checkNight(bucket, new Date("2026-10-04T09:00:00Z"), false, alert);
		await noteConfigMissing(bucket, "2026-10-04", MISSING, alert);
		expect(alert).toHaveBeenCalledTimes(1);

		// The token is set; the 5th's cron checks the 4th, which had no token: no email.
		await checkNight(bucket, new Date("2026-10-05T09:00:00Z"), true, alert);
		expect(alert).toHaveBeenCalledTimes(1);

		// The 5th's run never stored anything: the 6th's check says so, as usual.
		await checkNight(bucket, new Date("2026-10-06T09:00:00Z"), true, alert);
		expect(alert).toHaveBeenCalledTimes(2);
		expect(alert.mock.calls[1]?.[0]).toBe("2026-10-05");

		// A stored night isn't reported.
		bucket.objects.set("d1/2026/10/06.json", "{}");
		await checkNight(bucket, new Date("2026-10-07T09:00:00Z"), true, alert);
		expect(alert).toHaveBeenCalledTimes(2);
	});
});
