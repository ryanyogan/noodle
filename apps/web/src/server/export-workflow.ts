import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { clerkClient } from "@clerk/tanstack-react-start/server";
import { createDb, findMembershipByClerkUser, loadExportData } from "@noodle/db";
import type { DayKey } from "@noodle/domain";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import {
	EXPORT_LIFETIME_MS,
	type ExportMeta,
	exportAvailable,
	exportFiles,
	exportKey,
} from "../export-files";
import { clearedCheck, isClearedSince, stopIfCleared } from "./cleared-since";
import { getDb } from "./db";
import { type ExportParams, pendingKey } from "./export";
import { notifyHousehold } from "./notify";

// The Worker side of "Download your data" (ADR-0028), kept apart from the server functions the
// screen imports: the Export Workflow that builds the ZIP, the route that hands it out, and the
// nightly sweep.

export const EXPORT_PATH = "/download-your-data/";

/** R2 needs every part but the last the same size, at least 5 MiB. */
const PART_BYTES = 8 * 1024 * 1024;

const todayIn = (timeZone: string, now: Date) =>
	new Intl.DateTimeFormat("en-CA", { timeZone }).format(now) as DayKey;

/** Writes a stream of bytes to R2 as a multipart upload, holding at most a part and a chunk. */
class PartWriter {
	private chunks: Uint8Array[] = [];
	private size = 0;
	private parts: R2UploadedPart[] = [];
	constructor(private upload: R2MultipartUpload) {}
	push(chunk: Uint8Array) {
		this.chunks.push(chunk);
		this.size += chunk.length;
	}
	private take(bytes: number): Uint8Array {
		const out = new Uint8Array(bytes);
		let at = 0;
		while (at < bytes) {
			const chunk = this.chunks[0] as Uint8Array;
			const used = Math.min(chunk.length, bytes - at);
			out.set(chunk.subarray(0, used), at);
			at += used;
			if (used === chunk.length) this.chunks.shift();
			else this.chunks[0] = chunk.subarray(used);
		}
		this.size -= bytes;
		return out;
	}
	async flush(final = false) {
		while (this.size >= PART_BYTES) {
			this.parts.push(await this.upload.uploadPart(this.parts.length + 1, this.take(PART_BYTES)));
		}
		if (final) {
			if (this.size > 0 || this.parts.length === 0) {
				this.parts.push(await this.upload.uploadPart(this.parts.length + 1, this.take(this.size)));
			}
			await this.upload.complete(this.parts);
		}
	}
}

/** Builds the Parent's ZIP into R2 and returns its key. */
export async function buildExport(params: ExportParams, now: Date): Promise<string> {
	const db = createDb(env.DB);
	const viewer = { householdId: params.householdId, memberId: params.memberId };
	const data = await loadExportData(db, viewer, todayIn(params.timeZone, now), now.getTime());
	const key = exportKey(params.householdId, params.id);
	const meta: ExportMeta = {
		householdId: params.householdId,
		memberId: params.memberId,
		expiresAt: now.getTime() + EXPORT_LIFETIME_MS,
	};
	const upload = await env.STATEMENTS.createMultipartUpload(key, {
		httpMetadata: { contentType: "application/zip" },
		customMetadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
	});
	const writer = new PartWriter(upload);
	let failed: Error | null = null;
	const zip = new Zip((error, chunk) => {
		if (error) failed = error;
		else writer.push(chunk);
	});
	const encoder = new TextEncoder();
	for (const [name, text] of Object.entries(exportFiles(data))) {
		const file = new ZipDeflate(name, { level: 6 });
		zip.add(file);
		file.push(encoder.encode(text), true);
		await writer.flush();
	}
	for (const { key: fileKey, path } of data.files) {
		const object = await env.STATEMENTS.get(fileKey);
		if (!object) continue;
		const file = new ZipPassThrough(path);
		zip.add(file);
		const reader = object.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			file.push(value ?? new Uint8Array(), done);
			await writer.flush();
			if (done) break;
		}
	}
	zip.end();
	if (failed) {
		await upload.abort();
		throw failed;
	}
	await writer.flush(true);
	return key;
}

export class ExportWorkflow extends WorkflowEntrypoint<Env, ExportParams> {
	override async run(event: Readonly<WorkflowEvent<ExportParams>>, step: WorkflowStep) {
		const params = event.payload;
		const cleared = clearedCheck(createDb(this.env.DB), params.householdId, event.timestamp);
		const guarded = stopIfCleared(step, cleared, (message) => new NonRetryableError(message));
		try {
			const key = await guarded.do(
				"build the ZIP",
				{ retries: { limit: 2, delay: "10 seconds" } },
				() => buildExport(params, new Date()),
			);
			await guarded.do("tell the Household", async () => {
				await env.STATEMENTS.delete(pendingKey(params.householdId, params.id));
				await notifyHousehold(params.householdId, ["export"]);
			});
			return key;
		} catch (error) {
			if (!isClearedSince(error)) throw error;
			return null;
		}
	}
}

/**
 * GET /download-your-data/<id>.zip: the ZIP, only to the signed-in Parent it was made for, in
 * their Household, before it expires. Anything else is refused the same way.
 */
export async function handleExportDownload(request: Request): Promise<Response> {
	const id = new URL(request.url).pathname.slice(EXPORT_PATH.length).replace(/\.zip$/, "");
	if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return new Response("Not found", { status: 404 });
	const state = await clerkClient().authenticateRequest(request, { acceptsToken: "session_token" });
	const userId = state.isAuthenticated ? state.toAuth().userId : null;
	if (!userId) return new Response("Not signed in", { status: 401 });
	const membership = await findMembershipByClerkUser(getDb(), userId);
	if (!membership) return new Response("Not found", { status: 404 });
	const viewer = { householdId: membership.household.id, memberId: membership.parent.id };
	const object = await env.STATEMENTS.get(exportKey(viewer.householdId, id));
	if (!object || !exportAvailable(object.customMetadata, viewer, Date.now())) {
		await object?.body.cancel();
		return new Response("This download has expired or isn’t yours.", { status: 404 });
	}
	const date = new Date(object.uploaded).toISOString().slice(0, 10);
	return new Response(object.body, {
		headers: {
			"content-type": "application/zip",
			"content-length": String(object.size),
			"content-disposition": `attachment; filename="noodle-${date}.zip"`,
			"cache-control": "private, no-store",
		},
	});
}

/** Deletes downloads past their 24 hours, and preparing marks left by a failed run (nightly cron). */
export async function sweepExports(now: Date): Promise<void> {
	let cursor: string | undefined;
	do {
		const listed = await env.STATEMENTS.list({
			prefix: "exports/",
			include: ["customMetadata"],
			cursor,
		});
		const old = listed.objects
			.filter((o) => {
				const meta = o.customMetadata ?? {};
				const until = o.key.endsWith(".pending")
					? Number(meta.startedAt) + EXPORT_LIFETIME_MS
					: Number(meta.expiresAt);
				return !(now.getTime() < until);
			})
			.map((o) => o.key);
		if (old.length > 0) await env.STATEMENTS.delete(old);
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
}
