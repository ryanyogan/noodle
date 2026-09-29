import type { BankConnectionToSync } from "@noodle/db";
import { describe, expect, it } from "vitest";
import type { BankImportMessage } from "./bank-import-workflow";
import { webhookVerificationKey } from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";
import { signFakeWebhook } from "./plaid-fake-webhook-key";
import { type PlaidWebhookDeps, receivePlaidWebhook, verifyPlaidWebhook } from "./plaid-webhook";

// Plaid's webhooks, signed with the fake Plaid's key as Plaid signs its own, against the fake's
// /webhook_verification_key/get.

const now = new Date("2026-09-20T15:00:00Z");
const webhookKey = (keyId: string) =>
	webhookVerificationKey(fakePlaidTransport("2026-09-20"), keyId);

const connection: BankConnectionToSync = {
	householdId: "household",
	connectionId: "connection",
	timeZone: "America/Chicago",
	status: "ready",
};

function deps() {
	const synced: BankImportMessage[] = [];
	const marked: string[] = [];
	const notified: string[][] = [];
	const webhookDeps: PlaidWebhookDeps = {
		webhookKey,
		findConnections: async (itemId) => (itemId === "item-1" ? [connection] : []),
		sync: async (message) => void synced.push(message),
		markReconnect: async () => {
			marked.push("reconnect");
			return true;
		},
		markReconnected: async () => {
			marked.push("ready");
			return true;
		},
		notify: async (_householdId, changes) => void notified.push(changes),
		now,
	};
	return { webhookDeps, synced, marked, notified };
}

const post = async (payload: unknown, issuedAt = now) => {
	const body = JSON.stringify(payload);
	return new Request("https://noodle.example/webhooks/plaid", {
		method: "POST",
		headers: { "Plaid-Verification": await signFakeWebhook(body, issuedAt) },
		body,
	});
};

describe("verifying Plaid's webhooks", () => {
	it("accepts what Plaid signed, and nothing else", async () => {
		const body = JSON.stringify({ webhook_type: "TRANSACTIONS", item_id: "item-1" });
		const token = await signFakeWebhook(body, now);
		expect(await verifyPlaidWebhook(body, token, webhookKey, now)).toBe(true);
		// Another body under the same signature.
		expect(await verifyPlaidWebhook(`${body} `, token, webhookKey, now)).toBe(false);
		// A tampered signature, or none.
		expect(await verifyPlaidWebhook(body, `${token.slice(0, -4)}AAAA`, webhookKey, now)).toBe(
			false,
		);
		expect(await verifyPlaidWebhook(body, null, webhookKey, now)).toBe(false);
		// A key Plaid doesn't know.
		expect(await verifyPlaidWebhook(body, token, async () => null, now)).toBe(false);
	});

	it("refuses a signature more than five minutes old", async () => {
		const body = "{}";
		const old = await signFakeWebhook(body, new Date(now.getTime() - 6 * 60_000));
		expect(await verifyPlaidWebhook(body, old, webhookKey, now)).toBe(false);
	});
});

describe("acting on Plaid's webhooks", () => {
	it("syncs the Item's Bank Connections when it has new transactions", async () => {
		const { webhookDeps, synced } = deps();
		const response = await receivePlaidWebhook(
			await post({
				webhook_type: "TRANSACTIONS",
				webhook_code: "SYNC_UPDATES_AVAILABLE",
				item_id: "item-1",
			}),
			webhookDeps,
		);
		expect(response.status).toBe(200);
		expect(synced).toMatchObject([
			{
				kind: "bank-import",
				householdId: "household",
				connectionId: "connection",
				timeZone: "America/Chicago",
			},
		]);
	});

	it("marks a lapsed login for a reconnect, and syncs once it's repaired", async () => {
		const { webhookDeps, synced, marked, notified } = deps();
		await receivePlaidWebhook(
			await post({
				webhook_type: "ITEM",
				webhook_code: "ERROR",
				item_id: "item-1",
				error: { error_code: "ITEM_LOGIN_REQUIRED" },
			}),
			webhookDeps,
		);
		await receivePlaidWebhook(
			await post({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", item_id: "item-1" }),
			webhookDeps,
		);
		expect(marked).toEqual(["reconnect", "reconnect"]);
		expect(synced).toEqual([]);
		await receivePlaidWebhook(
			await post({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "item-1" }),
			webhookDeps,
		);
		expect(marked).toEqual(["reconnect", "reconnect", "ready"]);
		expect(synced).toHaveLength(1);
		expect(notified).toEqual([["bank-connections"], ["bank-connections"], ["bank-connections"]]);
	});

	it("refuses an unsigned webhook, and ignores one for an Item it doesn't know", async () => {
		const { webhookDeps, synced } = deps();
		const unsigned = new Request("https://noodle.example/webhooks/plaid", {
			method: "POST",
			body: JSON.stringify({ webhook_type: "TRANSACTIONS", item_id: "item-1" }),
		});
		expect((await receivePlaidWebhook(unsigned, webhookDeps)).status).toBe(401);
		const unknown = await receivePlaidWebhook(
			await post({
				webhook_type: "TRANSACTIONS",
				webhook_code: "SYNC_UPDATES_AVAILABLE",
				item_id: "item-2",
			}),
			webhookDeps,
		);
		expect(unknown.status).toBe(200);
		expect(synced).toEqual([]);
	});
});
