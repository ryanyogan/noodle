import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
	BackupConfigError,
	backupAlertEmail,
	backupKeys,
	buildManifest,
	exportConfig,
	previousNightKeys,
	runExport,
	tablesInDump,
	verifyBackup,
} from "./backup";
import { sendEmail } from "./email/send";

// The Backup Workflow (#79, ADR-0032): every night it exports the whole D1 database through the
// D1 export API into the noodle-backups bucket, writes a manifest beside it, checks it, and emails
// the operator (BACKUP_ALERT_TO) when anything fails. The nightly cron starts it, one per day.

export type BackupParams = { day: string };

type BackupEnv = {
	DB: D1Database;
	BACKUPS: R2Bucket;
	BACKUP_ACCOUNT_ID?: string;
	BACKUP_DATABASE_ID?: string;
	D1_EXPORT_TOKEN?: string;
	BACKUP_ALERT_TO?: string;
};

const backupEnv = () => env as unknown as BackupEnv;

const RETRY = {
	retries: { limit: 2, delay: "1 minute" as const, backoff: "exponential" as const },
	timeout: "30 minutes" as const,
};

/** Rows per table and the newest migration, read cheaply from the live database. */
async function countLive(db: D1Database) {
	const { results } = await db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
		)
		.all<{ name: string }>();
	const names = results.map((r) => r.name);
	const counts = await db.batch<{ n: number }>(
		names.map((name) => db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`)),
	);
	const tables = Object.fromEntries(names.map((name, i) => [name, counts[i]?.results[0]?.n ?? 0]));
	const migration = names.includes("d1_migrations")
		? ((await db
				.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
				.first<string>("name")) ?? null)
		: null;
	return { tables, migration };
}

/** Copies an object within the bucket (the binding has no server-side copy), streaming it. */
async function copyObject(bucket: R2Bucket, from: string, to: string) {
	if (await bucket.head(to)) return;
	const source = await bucket.get(from);
	if (!source) throw new Error(`${from} vanished before it could be copied.`);
	const fixed = new FixedLengthStream(source.size);
	const put = bucket.put(to, fixed.readable, { httpMetadata: source.httpMetadata });
	await source.body.pipeTo(fixed.writable);
	await put;
}

/** Emails the operator and logs; never throws, since it runs when something already went wrong. */
export async function alertOperator(date: string, problems: string[]) {
	console.error(`Backup for ${date} failed`, problems);
	const to = backupEnv().BACKUP_ALERT_TO;
	if (!to) {
		console.error("BACKUP_ALERT_TO isn’t set, so nobody was emailed about the failed backup.");
		return;
	}
	const sent = await sendEmail(to, backupAlertEmail(date, problems));
	if (!sent.ok) console.error("Couldn’t email the operator about the backup", sent.reason);
}

/**
 * The nightly cron's missed-night check: when last night's manifest isn't there (the Workflow
 * never ran, or failed without a word), say so.
 */
export async function checkLastNight(now: Date) {
	const keys = previousNightKeys(now);
	if (await backupEnv().BACKUPS.head(keys.manifest)) return;
	await alertOperator(keys.date, [`No backup was stored for ${keys.date} (${keys.manifest}).`]);
}

/** Starts tonight's backup, once per day (the instance id is the date). */
export async function startBackup(now: Date) {
	const { date } = backupKeys(now);
	try {
		await (env as unknown as { BACKUP: Workflow<BackupParams> }).BACKUP.create({
			id: `backup-${date}`,
			params: { day: now.toISOString() },
		});
	} catch (error) {
		// Already started today (a retried cron): nothing to do.
		if (String(error).includes("already exists")) return;
		throw error;
	}
}

export class BackupWorkflow extends WorkflowEntrypoint<Env, BackupParams> {
	override async run(event: Readonly<WorkflowEvent<BackupParams>>, step: WorkflowStep) {
		const keys = backupKeys(new Date(event.payload.day));
		try {
			return await this.backUp(keys, step);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await step.do("tell the operator", () => alertOperator(keys.date, [message]));
			throw error;
		}
	}

	private async backUp(keys: ReturnType<typeof backupKeys>, step: WorkflowStep) {
		const startedAt = await step.do("start", async () => Date.now());
		const live = await step.do("count the live rows", () => countLive(backupEnv().DB));

		const stored = await step.do("export and store", RETRY, async () => {
			const { BACKUPS } = backupEnv();
			// The bucket lock refuses overwrites, so a retry keeps what an earlier try stored.
			const already = await BACKUPS.head(keys.dump);
			if (already && already.size > 0) return { bytes: already.size, bookmark: null };
			let config: ReturnType<typeof exportConfig>;
			try {
				config = exportConfig(backupEnv());
			} catch (error) {
				if (error instanceof BackupConfigError) throw new NonRetryableError(error.message);
				throw error;
			}
			const ready = await runExport(config, {
				fetch: (input, init) => fetch(input, init),
				wait: (ms) => scheduler.wait(ms),
			});
			const download = await fetch(ready.signedUrl);
			if (!download.ok || !download.body) {
				throw new Error(`Couldn’t download the export (HTTP ${download.status}).`);
			}
			const length = Number(download.headers.get("content-length"));
			const httpMetadata = { contentType: "application/sql" };
			if (Number.isFinite(length) && length > 0) {
				const fixed = new FixedLengthStream(length);
				const put = BACKUPS.put(keys.dump, fixed.readable, { httpMetadata });
				await download.body.pipeTo(fixed.writable);
				await put;
			} else {
				await BACKUPS.put(keys.dump, await download.arrayBuffer(), { httpMetadata });
			}
			const object = await BACKUPS.head(keys.dump);
			return { bytes: object?.size ?? 0, bookmark: ready.bookmark };
		});

		const problems = await step.do("check the dump", async () => {
			const object = await backupEnv().BACKUPS.get(keys.dump);
			const dumpTables = object ? await tablesInDump(object.body) : new Set<string>();
			return verifyBackup(
				object ? { bytes: object.size } : null,
				Object.keys(live.tables),
				dumpTables,
			);
		});
		if (problems.length > 0) throw new NonRetryableError(problems.join(" "));

		const manifest = await step.do("write the manifest", async () => {
			const { BACKUPS } = backupEnv();
			const built = buildManifest({
				...keys,
				bytes: stored.bytes,
				bookmark: stored.bookmark,
				migration: live.migration,
				tables: live.tables,
				startedAt,
				finishedAt: Date.now(),
			});
			if (!(await BACKUPS.head(keys.manifest))) {
				await BACKUPS.put(keys.manifest, JSON.stringify(built, null, "\t"), {
					httpMetadata: { contentType: "application/json" },
				});
			}
			console.log("Backup stored", JSON.stringify(built));
			return built;
		});

		if (keys.monthlyDump && keys.monthlyManifest) {
			const { monthlyDump, monthlyManifest } = keys;
			await step.do("keep the monthly copy", async () => {
				const { BACKUPS } = backupEnv();
				await copyObject(BACKUPS, keys.dump, monthlyDump);
				await copyObject(BACKUPS, keys.manifest, monthlyManifest);
			});
		}
		return manifest;
	}
}
