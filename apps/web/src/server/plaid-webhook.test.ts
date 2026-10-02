import {
	addBankConnection,
	type BankConnectionToSync,
	createHouseholdForParent,
	loadBankConnectionsToMoveWebhook,
	saveBankWebhookUrl,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { describe, expect, it } from "vitest";
import { type BankImportParams, finishBankSync, startOneSync } from "./bank-import-run";
import type { BankImportMessage } from "./bank-import-workflow";
import { cachedWebhookKeys, createLinkToken, webhookVerificationKey } from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";
import { FAKE_WEBHOOK_KEY_ID, signFakeWebhook } from "./plaid-fake-webhook-key";
import {
	bankProblemNotice,
	type PlaidWebhookDeps,
	type PlaidWebhookLog,
	receivePlaidWebhook,
	verifyPlaidWebhook,
} from "./plaid-webhook";
import { moveBankWebhooks } from "./plaid-webhook-move";

// Plaid's webhooks, signed with the fake Plaid's key as Plaid signs its own, against the fake's
// /webhook_verification_key/get.

const now = new Date("2026-09-20T15:00:00Z");
const transport = fakePlaidTransport("2026-09-20");
const webhookKey = (keyId: string) => webhookVerificationKey(transport, keyId);

const connection: BankConnectionToSync = {
	householdId: "household",
	connectionId: "connection",
	timeZone: "America/Chicago",
	status: "ready",
};

function deps(found: BankConnectionToSync = connection) {
	const synced: BankImportMessage[] = [];
	const marked: string[] = [];
	const notified: string[][] = [];
	const notices: string[] = [];
	const webhooks: (string | null)[] = [];
	const logs: PlaidWebhookLog[] = [];
	const mark = (what: string) => async () => {
		marked.push(what);
		return true;
	};
	const webhookDeps: PlaidWebhookDeps = {
		webhookKey,
		findConnections: async (itemId) => (itemId === "item-1" ? [found] : []),
		sync: async (message) => void synced.push(message),
		markReconnect: mark("reconnect"),
		markReconnected: mark("ready"),
		markDisconnected: mark("disconnected"),
		markNewAccounts: mark("new-accounts"),
		saveNotice: async (_connection, notice) => void notices.push(notice),
		recordWebhook: async (_connection, _at, url) => void webhooks.push(url),
		notify: async (_householdId, changes) => void notified.push(changes),
		log: (line) => void logs.push(line),
		now,
	};
	return { webhookDeps, synced, marked, notified, notices, webhooks, logs };
}

const post = async (payload: unknown, issuedAt = now) => {
	const body = JSON.stringify(payload);
	return new Request("https://noodle.example/webhooks/plaid", {
		method: "POST",
		headers: { "Plaid-Verification": await signFakeWebhook(body, issuedAt) },
		body,
	});
};

const item = (webhook_code: string, more: Record<string, unknown> = {}) =>
	post({ webhook_type: "ITEM", webhook_code, item_id: "item-1", ...more });

const syncUpdates = (item_id = "item-1") =>
	post({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id });

const encode = (value: unknown) =>
	btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

describe("verifying Plaid's webhooks", () => {
	const body = JSON.stringify({ webhook_type: "TRANSACTIONS", item_id: "item-1" });

	it("accepts what Plaid signed, as text or as the bytes that came", async () => {
		const token = await signFakeWebhook(body, now);
		expect(await verifyPlaidWebhook(body, token, webhookKey, now)).toBe(true);
		const bytes = new TextEncoder().encode(body);
		expect(await verifyPlaidWebhook(bytes, token, webhookKey, now)).toBe(true);
	});

	it("refuses a token that isn't ES256, without asking for a key", async () => {
		const [, payload, signature] = (await signFakeWebhook(body, now)).split(".");
		let asked = 0;
		const counting = async (keyId: string) => {
			asked++;
			return webhookKey(keyId);
		};
		for (const alg of ["HS256", "none", "RS256", "ES384"]) {
			const token = `${encode({ alg, kid: FAKE_WEBHOOK_KEY_ID, typ: "JWT" })}.${payload}.${signature}`;
			expect(await verifyPlaidWebhook(body, token, counting, now)).toBe(false);
		}
		expect(asked).toBe(0);
	});

	it("refuses a key ID Plaid doesn't know", async () => {
		const [, payload, signature] = (await signFakeWebhook(body, now)).split(".");
		const token = `${encode({ alg: "ES256", kid: "someone-else's", typ: "JWT" })}.${payload}.${signature}`;
		expect(await verifyPlaidWebhook(body, token, webhookKey, now)).toBe(false);
		const signedToken = await signFakeWebhook(body, now);
		expect(await verifyPlaidWebhook(body, signedToken, async () => null, now)).toBe(false);
	});

	it("refuses a tampered signature, a missing one, and a token that isn't one", async () => {
		const token = await signFakeWebhook(body, now);
		expect(await verifyPlaidWebhook(body, `${token.slice(0, -4)}AAAA`, webhookKey, now)).toBe(
			false,
		);
		expect(await verifyPlaidWebhook(body, null, webhookKey, now)).toBe(false);
		expect(await verifyPlaidWebhook(body, "not.a-token", webhookKey, now)).toBe(false);
	});

	it("refuses a signature more than five minutes from now, either way", async () => {
		const old = await signFakeWebhook(body, new Date(now.getTime() - 6 * 60_000));
		expect(await verifyPlaidWebhook(body, old, webhookKey, now)).toBe(false);
		const ahead = await signFakeWebhook(body, new Date(now.getTime() + 6 * 60_000));
		expect(await verifyPlaidWebhook(body, ahead, webhookKey, now)).toBe(false);
		const recent = await signFakeWebhook(body, new Date(now.getTime() - 4 * 60_000));
		expect(await verifyPlaidWebhook(body, recent, webhookKey, now)).toBe(true);
	});

	it("refuses a body whose SHA-256 isn't the one signed", async () => {
		const token = await signFakeWebhook(body, now);
		expect(await verifyPlaidWebhook(`${body} `, token, webhookKey, now)).toBe(false);
		const other = JSON.stringify({ webhook_type: "TRANSACTIONS", item_id: "item-2" });
		expect(await verifyPlaidWebhook(other, token, webhookKey, now)).toBe(false);
	});

	it("keeps Plaid's key by its ID, and asks again for one it doesn't have", async () => {
		const asked: string[] = [];
		let clock = 0;
		const keys = cachedWebhookKeys(
			async (keyId) => {
				asked.push(keyId);
				return webhookKey(keyId);
			},
			new Map(),
			() => clock,
		);
		expect(await keys(FAKE_WEBHOOK_KEY_ID)).not.toBeNull();
		expect(await keys(FAKE_WEBHOOK_KEY_ID)).not.toBeNull();
		expect(asked).toEqual([FAKE_WEBHOOK_KEY_ID]);
		// One Plaid doesn't know isn't kept: it's asked for each time, in case Plaid rotated to it.
		expect(await keys("rotated")).toBeNull();
		expect(await keys("rotated")).toBeNull();
		expect(asked).toEqual([FAKE_WEBHOOK_KEY_ID, "rotated", "rotated"]);
		// And a kept one is asked for afresh after a day.
		clock = 25 * 60 * 60 * 1000;
		await keys(FAKE_WEBHOOK_KEY_ID);
		expect(asked).toHaveLength(4);
	});
});

describe("answering Plaid's webhooks", () => {
	it("refuses an unsigned webhook with a 401, and logs it without believing its body", async () => {
		const { webhookDeps, synced, logs } = deps();
		const unsigned = new Request("https://noodle.example/webhooks/plaid", {
			method: "POST",
			body: JSON.stringify({
				webhook_type: "TRANSACTIONS",
				webhook_code: "SYNC_UPDATES_AVAILABLE",
				item_id: "item-1",
			}),
		});
		expect((await receivePlaidWebhook(unsigned, webhookDeps)).status).toBe(401);
		expect(synced).toEqual([]);
		expect(logs).toEqual([
			{
				log: "plaid-webhook",
				type: null,
				code: null,
				item_id: null,
				error_code: null,
				outcome: "rejected",
			},
		]);
	});

	it("answers 200 for an Item it doesn't know, and for an event it doesn't act on", async () => {
		const { webhookDeps, synced, marked, logs } = deps();
		expect((await receivePlaidWebhook(await syncUpdates("item-2"), webhookDeps)).status).toBe(200);
		const unknown = await post({
			webhook_type: "HOLDINGS",
			webhook_code: "DEFAULT_UPDATE",
			item_id: "item-1",
		});
		expect((await receivePlaidWebhook(unknown, webhookDeps)).status).toBe(200);
		expect(synced).toEqual([]);
		expect(marked).toEqual([]);
		expect(logs.map((line) => line.outcome)).toEqual(["ignored", "ignored"]);
	});

	it("answers 5xx only when the app itself failed, so Plaid sends it again", async () => {
		const { webhookDeps, logs } = deps();
		const queueDown = await receivePlaidWebhook(await syncUpdates(), {
			...webhookDeps,
			sync: async () => {
				throw new Error("Queue down");
			},
		});
		expect(queueDown.status).toBe(500);
		const keyDown = await receivePlaidWebhook(await syncUpdates(), {
			...webhookDeps,
			webhookKey: async () => {
				throw new Error("Plaid unreachable");
			},
		});
		expect(keyDown.status).toBe(500);
		expect(logs.map((line) => line.outcome)).toEqual(["failed", "failed"]);
		const get = new Request("https://noodle.example/webhooks/plaid");
		expect((await receivePlaidWebhook(get, webhookDeps)).status).toBe(405);
	});

	it("logs one line a webhook: its type, code, Item and outcome, and nothing else", async () => {
		const { webhookDeps, logs } = deps();
		await receivePlaidWebhook(
			await item("ERROR", {
				error: { error_code: "INSTITUTION_DOWN", error_message: "Chase is down for Alex" },
				account_name: "Alex's checking",
			}),
			webhookDeps,
		);
		expect(logs).toEqual([
			{
				log: "plaid-webhook",
				type: "ITEM",
				code: "ERROR",
				item_id: "item-1",
				error_code: "INSTITUTION_DOWN",
				outcome: "marked",
			},
		]);
	});
});

describe("acting on Plaid's webhooks", () => {
	it("syncs the Item's Bank Connections when it has new transactions", async () => {
		const { webhookDeps, synced, webhooks, logs } = deps();
		const response = await receivePlaidWebhook(await syncUpdates(), webhookDeps);
		expect(response.status).toBe(200);
		expect(synced).toMatchObject([
			{
				kind: "bank-import",
				householdId: "household",
				connectionId: "connection",
				timeZone: "America/Chicago",
			},
		]);
		expect(webhooks).toEqual([null]);
		expect(logs[0]?.outcome).toBe("synced");
	});

	it("acknowledges the older Transactions webhooks and does nothing", async () => {
		const { webhookDeps, synced, marked, logs } = deps();
		for (const webhook_code of ["INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE"]) {
			const response = await receivePlaidWebhook(
				await post({ webhook_type: "TRANSACTIONS", webhook_code, item_id: "item-1" }),
				webhookDeps,
			);
			expect(response.status).toBe(200);
		}
		expect(synced).toEqual([]);
		expect(marked).toEqual([]);
		expect(logs.map((line) => line.outcome)).toEqual(["ignored", "ignored", "ignored"]);
	});

	it("marks a lapsed login for a reconnect, and syncs once it's repaired", async () => {
		const { webhookDeps, synced, marked, notified } = deps();
		await receivePlaidWebhook(
			await item("ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } }),
			webhookDeps,
		);
		await receivePlaidWebhook(await item("PENDING_EXPIRATION"), webhookDeps);
		await receivePlaidWebhook(await item("PENDING_DISCONNECT"), webhookDeps);
		expect(marked).toEqual(["reconnect", "reconnect", "reconnect"]);
		expect(synced).toEqual([]);
		await receivePlaidWebhook(await item("LOGIN_REPAIRED"), webhookDeps);
		expect(marked).toEqual(["reconnect", "reconnect", "reconnect", "ready"]);
		expect(synced).toHaveLength(1);
		expect(notified).toHaveLength(4);
	});

	it("disconnects the Bank Connection when the Parent revoked access at the bank", async () => {
		for (const code of ["USER_PERMISSION_REVOKED", "USER_ACCOUNT_REVOKED"]) {
			const { webhookDeps, synced, marked, notified, logs } = deps();
			expect((await receivePlaidWebhook(await item(code), webhookDeps)).status).toBe(200);
			expect(marked).toEqual(["disconnected"]);
			expect(notified).toEqual([["bank-connections"]]);
			expect(synced).toEqual([]);
			expect(logs[0]?.outcome).toBe("marked");
		}
	});

	it("reads nothing from a disconnected Bank Connection, whatever comes later", async () => {
		const { webhookDeps, synced, notices } = deps({ ...connection, status: "disconnected" });
		await receivePlaidWebhook(await syncUpdates(), webhookDeps);
		await receivePlaidWebhook(await item("LOGIN_REPAIRED"), webhookDeps);
		await receivePlaidWebhook(
			await item("ERROR", { error: { error_code: "INSTITUTION_DOWN" } }),
			webhookDeps,
		);
		expect(synced).toEqual([]);
		expect(notices).toEqual([]);
	});

	it("offers a new account at the bank", async () => {
		const { webhookDeps, marked, notified } = deps();
		await receivePlaidWebhook(await item("NEW_ACCOUNTS_AVAILABLE"), webhookDeps);
		expect(marked).toEqual(["new-accounts"]);
		expect(notified).toEqual([["bank-connections"]]);
	});

	it("says in plain words when the bank is down, without asking for a login", async () => {
		const { webhookDeps, marked, notices, notified } = deps();
		for (const error_code of ["INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "NO_ACCOUNTS"]) {
			await receivePlaidWebhook(await item("ERROR", { error: { error_code } }), webhookDeps);
		}
		expect(marked).toEqual([]);
		expect(notices).toEqual([
			bankProblemNotice("INSTITUTION_DOWN"),
			bankProblemNotice("INSTITUTION_DOWN"),
			bankProblemNotice("NO_ACCOUNTS"),
		]);
		expect(notices[0]).toContain("isn’t answering right now");
		expect(notices[2]).toContain("no accounts");
		for (const notice of notices) expect(notice).not.toMatch(/log in|reconnect|INSTITUTION/i);
		expect(notified).toHaveLength(3);
	});

	it("records the address Plaid acknowledges it now sends webhooks to", async () => {
		const { webhookDeps, webhooks, logs } = deps();
		const url = "https://noodle.example/webhooks/plaid";
		await receivePlaidWebhook(
			await item("WEBHOOK_UPDATE_ACKNOWLEDGED", { new_webhook_url: url }),
			webhookDeps,
		);
		expect(webhooks).toEqual([url]);
		expect(logs[0]?.outcome).toBe("marked");
	});
});

describe("one sync at a time for a Bank Connection", () => {
	const params: BankImportParams = {
		householdId: "household",
		connectionId: "conn-1",
		timeZone: "America/Chicago",
		runId: "run-1",
	};

	async function connected() {
		const db = testDb();
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-user",
			householdId: "household",
			householdName: "The Rinks",
			timeZone: "America/Chicago",
			parentId: "parent",
			parentName: "Alex",
		});
		await addBankConnection(db, {
			householdId: "household",
			connectionId: "conn-1",
			provider: "plaid",
			externalId: "item-1",
			institution: "Chase",
			credential: "sealed",
			createdByMemberId: "parent",
		});
		return db;
	}

	it("starts one sync for a webhook Plaid sent twice, and one more when it ends", async () => {
		const db = await connected();
		const started: string[] = [];
		const start = (runId: string) =>
			startOneSync(db, { ...params, runId }, now, async () => void started.push(runId));
		expect(await start("first")).toBe(true);
		// The repeat, and the daily sync landing on it: neither starts a second run beside it.
		expect(await start("repeat")).toBe(false);
		expect(await start("daily-2026-09-20")).toBe(false);
		expect(started).toEqual(["first"]);

		// When the run ends, the ones that came meanwhile fold into a single next run.
		const next: BankImportParams[] = [];
		await finishBankSync(db, params, async ({ kind: _, ...message }) => void next.push(message));
		expect(next).toHaveLength(1);
		expect(await start(next[0]?.runId ?? "")).toBe(true);
		await finishBankSync(db, params, async ({ kind: _, ...message }) => void next.push(message));
		expect(next).toHaveLength(1);
	});

	it("lets go of a Bank Connection whose sync couldn't start, so the retry can take it", async () => {
		const db = await connected();
		await expect(
			startOneSync(db, params, now, async () => {
				throw new Error("Workflows down");
			}),
		).rejects.toThrow("Workflows down");
		expect(await startOneSync(db, params, now, async () => {})).toBe(true);
	});

	it("moves each Bank Connection's webhooks to the app's address once", async () => {
		const db = await connected();
		const url = "https://noodle.example/webhooks/plaid";
		const updated: string[] = [];
		const moveDeps = {
			connections: (webhookUrl: string) =>
				loadBankConnectionsToMoveWebhook(db, "plaid", webhookUrl),
			open: async () => "access-token",
			update: async (_accessToken: string, webhookUrl: string) => void updated.push(webhookUrl),
			save: ({ householdId, id }: { householdId: string; id: string }, webhookUrl: string) =>
				saveBankWebhookUrl(db, householdId, id, webhookUrl),
			log: () => {},
		};
		expect(await moveBankWebhooks(moveDeps, url)).toEqual({ moved: 1, failed: 0 });
		expect(await moveBankWebhooks(moveDeps, url)).toEqual({ moved: 0, failed: 0 });
		expect(updated).toEqual([url]);
		// One Plaid refuses is counted and left to be tried again.
		await saveBankWebhookUrl(db, "household", "conn-1", "https://old.example/webhooks/plaid");
		const refused = {
			...moveDeps,
			update: async () => {
				throw new Error("Plaid said no");
			},
		};
		expect(await moveBankWebhooks(refused, url)).toEqual({ moved: 0, failed: 1 });
		expect(await moveBankWebhooks(moveDeps, url)).toEqual({ moved: 1, failed: 0 });
	});
});

describe("link tokens", () => {
	it("name the app's webhook, and ask for account selection only to add new accounts", async () => {
		const calls: Record<string, unknown>[] = [];
		const recording = async (path: string, body: Record<string, unknown>) => {
			calls.push(body);
			return transport(path, body);
		};
		const webhook = "https://noodle.example/webhooks/plaid";
		await createLinkToken(recording, "household", { webhook });
		await createLinkToken(recording, "household", { webhook, accessToken: "access" });
		await createLinkToken(recording, "household", {
			webhook,
			accessToken: "access",
			accountSelection: true,
		});
		expect(calls.map((call) => call.webhook)).toEqual([webhook, webhook, webhook]);
		expect(calls.map((call) => call.update)).toEqual([
			undefined,
			undefined,
			{ account_selection_enabled: true },
		]);
	});
});
