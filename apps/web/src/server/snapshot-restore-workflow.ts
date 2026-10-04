import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { clerkClient } from "@clerk/tanstack-react-start/server";
import {
	clearForRestore,
	linkedBankConnectionIds,
	listParents,
	RESTORED_BY_INSERT,
	removeBankConnection,
	restoreHouseholdRow,
	restoreMembers,
	restoreTable,
	snapshotRefusal,
} from "@noodle/db";
import { disconnectBankConnection } from "./bank-disconnect";
import { getDb } from "./db";
import { sendEmail } from "./email/send";
import { emailHtml } from "./email/templates";
import { clearDeps } from "./fresh-start-workflow";
import { notifyHousehold } from "./notify";
import type { NudgeDelivery } from "./nudge-delivery";
import { newestMigration, readSnapshot } from "./snapshot-store";

// Restoring a Household snapshot (#78, ADR-0035). The Parent's typed confirmation and the
// "Before restore" snapshot happen before this starts (snapshots.ts). Then, a step at a time, each
// retried alone: banks linked since the snapshot are disconnected, background work stops, the
// Household's rows are cleared like a Fresh start's, and each table is put back in batches with
// its count checked. Every step reads the file again: steps hand on only small results.

export type RestoreParams = {
	householdId: string;
	/** The snapshot being restored, and its file in noodle-backups. */
	snapshotId: string;
	key: string;
	takenAt: number;
	/** The Parent who asked. */
	parentId: string;
};

/** What the Workflow ends with: done, or the reason it refused before touching anything. */
export type RestoreOutput = { ok: true } | { ok: false; reason: string };

const RETRY = {
	retries: { limit: 5, delay: "15 seconds" as const, backoff: "exponential" as const },
};

async function load(key: string) {
	const file = await readSnapshot(env.BACKUPS, key);
	if (!file) throw new NonRetryableError("The snapshot's file is gone");
	return file;
}

const day = (ms: number) =>
	new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Emails a Parent at their verified primary address in Clerk, as the Check-in does. */
async function emailParent(clerkUserId: string, title: string, body: string) {
	const user = await clerkClient().users.getUser(clerkUserId);
	const address = user.primaryEmailAddress;
	if (address?.verification?.status !== "verified") return;
	const origin = (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN;
	const url = origin ? new URL("/household#snapshots", origin).toString() : null;
	await sendEmail(address.emailAddress, {
		subject: title,
		text: [title, body, url].filter(Boolean).join("\n\n"),
		html: emailHtml({
			preview: body,
			heading: title,
			paragraphs: [body],
			button: url ? { label: "See snapshots", href: url } : undefined,
		}),
	});
}

export class SnapshotRestoreWorkflow extends WorkflowEntrypoint<Env, RestoreParams> {
	override async run(
		event: Readonly<WorkflowEvent<RestoreParams>>,
		step: WorkflowStep,
	): Promise<RestoreOutput> {
		const { householdId, key, takenAt, parentId } = event.payload;
		const checked = await step.do("check the snapshot", async () => {
			const file = await load(key);
			const reason = snapshotRefusal(file, householdId, await newestMigration(env.DB));
			const tables = Object.entries(file.tables)
				.filter(([, rows]) => rows.length > 0)
				.map(([name]) => name);
			const banks = (file.tables.bankConnections ?? []).map((row) => String(row.id));
			return { reason, tables, banks };
		});
		if (checked.reason) return { ok: false, reason: checked.reason };

		// A bank linked since the snapshot would be left linked with nothing pointing at it.
		await step.do("disconnect banks the snapshot doesn't have", RETRY, async () => {
			const keep = new Set(checked.banks);
			const deps = clearDeps(householdId);
			for (const connectionId of await linkedBankConnectionIds(getDb(), householdId)) {
				if (keep.has(connectionId)) continue;
				if (!deps.bank) {
					await removeBankConnection(getDb(), householdId, connectionId);
					continue;
				}
				const result = await disconnectBankConnection(
					{ db: getDb(), ...deps.bank },
					{ householdId, connectionId },
				);
				if (!result.ok && result.reason === "bank") throw new Error("Couldn’t disconnect a bank");
			}
		});
		await step.do("stop background work", RETRY, () =>
			env.HOUSEHOLD_AGENT.getByName(householdId).clearHousehold(),
		);
		await step.do("clear the Household's rows", RETRY, () => clearForRestore(getDb(), householdId));
		await step.do("put back members", RETRY, async () =>
			restoreMembers(getDb(), householdId, (await load(key)).tables.members ?? []),
		);
		const present = new Set(checked.tables);
		for (const name of RESTORED_BY_INSERT) {
			if (!present.has(name)) continue;
			await step.do(`put back ${name}`, RETRY, async () =>
				restoreTable(getDb(), householdId, name, (await load(key)).tables[name] ?? []),
			);
		}
		await step.do("put back the Household", RETRY, async () =>
			restoreHouseholdRow(getDb(), householdId, (await load(key)).tables.households ?? []),
		);

		// Every open screen refetches; the other Parent gets a Nudge and an email.
		await step.do("tell the Household", async () => {
			await notifyHousehold(householdId, [
				"months",
				"members",
				"parents",
				"goals",
				"bank-connections",
				"rules",
				"insights",
				"perks",
				"check-in",
				"setup",
				"reports",
			]);
			const parents = await listParents(getDb(), householdId);
			const by = parents.find((parent) => parent.id === parentId)?.name ?? "A Parent";
			const title = `${by} restored the snapshot from ${day(takenAt)}`;
			const body =
				"Your Household’s data is back to how it was then. A snapshot of how it was just before is in Household settings.";
			for (const other of parents.filter((parent) => parent.id !== parentId)) {
				await env.NUDGE_QUEUE.send({
					householdId,
					memberId: other.id,
					nudge: {
						kind: "test",
						title,
						body,
						tag: `restore-${event.instanceId}`,
						url: "/household#snapshots",
					},
				} satisfies NudgeDelivery);
				if (!other.clerkUserId) continue;
				await emailParent(other.clerkUserId, title, body).catch((error) => {
					console.error(`Couldn’t email ${other.id} about the restore`, error);
				});
			}
			console.log(
				"Snapshot restored",
				JSON.stringify({ householdId, snapshot: event.payload.snapshotId }),
			);
		});
		return { ok: true };
	}
}
