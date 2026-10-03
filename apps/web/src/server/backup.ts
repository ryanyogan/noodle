import type { Email } from "./email/templates";

// The nightly whole-database backup (#79, ADR-0032): the pure parts the Backup Workflow runs, so
// they can be tested with the D1 export API and R2 faked. The Workflow itself is backup-workflow.ts.

/** Where one night's dump and manifest go, and the monthly copies made on the 1st. */
export function backupKeys(day: Date) {
	const yyyy = String(day.getUTCFullYear());
	const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(day.getUTCDate()).padStart(2, "0");
	const monthly = day.getUTCDate() === 1;
	return {
		date: `${yyyy}-${mm}-${dd}`,
		dump: `d1/${yyyy}/${mm}/${dd}.sql`,
		manifest: `d1/${yyyy}/${mm}/${dd}.json`,
		monthlyDump: monthly ? `d1/monthly/${yyyy}-${mm}.sql` : null,
		monthlyManifest: monthly ? `d1/monthly/${yyyy}-${mm}.json` : null,
	};
}

/** The night before `now`'s, whose manifest the missed-night check looks for. */
export function previousNightKeys(now: Date) {
	return backupKeys(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export type BackupManifest = {
	date: string;
	dump: string;
	bytes: number;
	/** The Time Travel bookmark the export was taken at. */
	bookmark: string | null;
	/** The newest migration applied (d1_migrations), so a restore knows the schema it gets. */
	migration: string | null;
	/** Rows per table in the live database, counted just before the export. */
	tables: Record<string, number>;
	startedAt: string;
	durationMs: number;
};

export function buildManifest(input: {
	date: string;
	dump: string;
	bytes: number;
	bookmark: string | null;
	migration: string | null;
	tables: Record<string, number>;
	startedAt: number;
	finishedAt: number;
}): BackupManifest {
	return {
		date: input.date,
		dump: input.dump,
		bytes: input.bytes,
		bookmark: input.bookmark,
		migration: input.migration,
		tables: input.tables,
		startedAt: new Date(input.startedAt).toISOString(),
		durationMs: input.finishedAt - input.startedAt,
	};
}

/**
 * What's wrong with a stored dump, if anything: missing, empty, or missing a table the live
 * database has (Cloudflare's own `_cf_` tables aside). An empty list means it checked out.
 */
export function verifyBackup(
	stored: { bytes: number } | null,
	liveTables: string[],
	dumpTables: Set<string>,
): string[] {
	if (!stored) return ["The dump isn’t in noodle-backups."];
	if (stored.bytes <= 0) return ["The dump is empty."];
	const missing = liveTables.filter((t) => !t.startsWith("_cf_") && !dumpTables.has(t));
	return missing.length > 0 ? [`The dump has no CREATE TABLE for: ${missing.join(", ")}.`] : [];
}

const CREATE_TABLE = /^CREATE TABLE (?:IF NOT EXISTS )?["`[]?([^"`\]\s(]+)/i;

/** The tables a SQL dump creates, read a line at a time so a large dump never sits in memory. */
export async function tablesInDump(body: ReadableStream<Uint8Array>): Promise<Set<string>> {
	const tables = new Set<string>();
	const decoder = new TextDecoder();
	let rest = "";
	const take = (line: string) => {
		const match = CREATE_TABLE.exec(line);
		if (match?.[1]) tables.add(match[1]);
	};
	const reader = body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		const lines = (rest + decoder.decode(value, { stream: true })).split("\n");
		rest = lines.pop() ?? "";
		for (const line of lines) take(line);
	}
	take(rest + decoder.decode());
	return tables;
}

// The D1 export API: POST /accounts/:account/d1/database/:db/export with output_format "polling",
// then POST again with the bookmark it answered until the status is "complete"; the result's
// signed_url serves the SQL for an hour.

export type ExportConfig = { accountId: string; databaseId: string; token: string };

type ExportAnswer = {
	success: boolean;
	errors?: { message: string }[];
	result?: {
		at_bookmark?: string;
		status?: "active" | "complete" | "error";
		error?: string;
		messages?: string[];
		result?: { filename?: string; signed_url?: string };
	};
};

export type ExportReady = { signedUrl: string; bookmark: string | null; filename: string | null };

export class BackupConfigError extends Error {}

/** The export API's settings from the Worker's env, or a plain error naming what's missing. */
export function exportConfig(env: {
	BACKUP_ACCOUNT_ID?: string;
	BACKUP_DATABASE_ID?: string;
	D1_EXPORT_TOKEN?: string;
}): ExportConfig {
	const missing = (
		[
			["BACKUP_ACCOUNT_ID", env.BACKUP_ACCOUNT_ID],
			["BACKUP_DATABASE_ID", env.BACKUP_DATABASE_ID],
			["D1_EXPORT_TOKEN", env.D1_EXPORT_TOKEN],
		] as const
	)
		.filter(([, value]) => !value)
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new BackupConfigError(`The backup isn’t set up: ${missing.join(", ")} missing.`);
	}
	return {
		accountId: env.BACKUP_ACCOUNT_ID as string,
		databaseId: env.BACKUP_DATABASE_ID as string,
		token: env.D1_EXPORT_TOKEN as string,
	};
}

/** Starts an export and polls until its SQL is ready to download. */
export async function runExport(
	config: ExportConfig,
	deps: {
		fetch: typeof fetch;
		wait: (ms: number) => Promise<void>;
		/** How many polls before giving up (each waits a little longer, up to 10 seconds). */
		maxPolls?: number;
	},
): Promise<ExportReady> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/export`;
	let bookmark: string | undefined;
	const maxPolls = deps.maxPolls ?? 90;
	for (let poll = 0; poll < maxPolls; poll++) {
		if (poll > 0) await deps.wait(Math.min(1000 * 2 ** (poll - 1), 10_000));
		const response = await deps.fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				output_format: "polling",
				...(bookmark ? { current_bookmark: bookmark } : {}),
			}),
		});
		const answer = (await response.json().catch(() => null)) as ExportAnswer | null;
		if (!response.ok || !answer?.success || !answer.result) {
			const why = answer?.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`;
			throw new Error(`The D1 export API refused: ${why}`);
		}
		const { result } = answer;
		bookmark = result.at_bookmark ?? bookmark;
		if (result.status === "error")
			throw new Error(`The D1 export failed: ${result.error ?? "no reason given"}`);
		const signedUrl = result.result?.signed_url;
		if (result.status === "complete" && signedUrl) {
			return { signedUrl, bookmark: bookmark ?? null, filename: result.result?.filename ?? null };
		}
	}
	throw new Error("The D1 export didn’t finish in time.");
}

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The email the operator gets when a night's backup failed or never ran. */
export function backupAlertEmail(date: string, problems: string[]): Email {
	const subject = `Noodle’s database backup for ${date} didn’t work`;
	const lines = [
		`The nightly D1 backup to noodle-backups for ${date} didn’t work:`,
		...problems.map((p) => `- ${p}`),
		"See docs/runbooks/restore.md, and the Worker's logs (noodle-backup Workflow).",
	];
	return {
		subject,
		text: lines.join("\n"),
		html: `<p>${lines.map(escapeHtml).join("<br>")}</p>`,
	};
}
