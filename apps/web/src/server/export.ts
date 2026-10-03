import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { exportAvailable } from "../export-files";
import { householdMiddleware } from "./household";

// "Download your data" (ADR-0028): a Workflow builds the Parent's ZIP into R2 a part at a time,
// a route hands it only to that Parent while it lasts (24 hours), and the nightly cron deletes
// what has expired.

export type ExportParams = { id: string; householdId: string; memberId: string; timeZone: string };

export type ExportStatus =
	| { state: "none" }
	| { state: "preparing" }
	| { state: "ready"; id: string; expiresAt: number };

/** A preparing download that hasn't finished in this long has failed; it can be asked for again. */
const PREPARING_FOR_MS = 30 * 60 * 1000;

export const pendingKey = (householdId: string, id: string) =>
	`exports/${householdId}/${id}.pending`;

/** The Parent's download: ready, still preparing, or none. */
async function exportStatus(viewer: { householdId: string; memberId: string }, now: number) {
	const listed = await env.STATEMENTS.list({
		prefix: `exports/${viewer.householdId}/`,
		include: ["customMetadata"],
	});
	let status: ExportStatus = { state: "none" };
	for (const object of listed.objects) {
		const meta = object.customMetadata;
		if (meta?.memberId !== viewer.memberId) continue;
		if (object.key.endsWith(".zip") && exportAvailable(meta, viewer, now)) {
			const id = object.key.slice(object.key.lastIndexOf("/") + 1, -".zip".length);
			const expiresAt = Number(meta.expiresAt);
			if (status.state !== "ready" || expiresAt > status.expiresAt) {
				status = { state: "ready", id, expiresAt };
			}
		} else if (
			object.key.endsWith(".pending") &&
			now - Number(meta.startedAt) < PREPARING_FOR_MS &&
			status.state === "none"
		) {
			status = { state: "preparing" };
		}
	}
	return status;
}

const viewerOfContext = (context: { household: { id: string }; parent: { id: string } }) => ({
	householdId: context.household.id,
	memberId: context.parent.id,
});

export const getExportStatus = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<ExportStatus> => exportStatus(viewerOfContext(context), Date.now()),
	);

/** Starts preparing the Parent's download, unless one is already on its way. */
export const prepareExport = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<ExportStatus> => {
		const viewer = viewerOfContext(context);
		const current = await exportStatus(viewer, Date.now());
		if (current.state === "preparing") return current;
		const id = ulid();
		await env.STATEMENTS.put(pendingKey(viewer.householdId, id), "", {
			customMetadata: { memberId: viewer.memberId, startedAt: String(Date.now()) },
		});
		await env.EXPORT.create({
			id,
			params: { id, ...viewer, timeZone: context.household.timeZone },
		});
		return { state: "preparing" };
	});
