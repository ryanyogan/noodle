import { describe, expect, it } from "vitest";
import { BankProviderError } from "./bank-connection";
import {
	connectRealBankShown,
	createLinkToken,
	HISTORY_DAYS,
	type PlaidTransport,
	plaidNotSetUp,
	plaidProvider,
	plaidTransport,
	webhookVerificationKey,
} from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";
import { FAKE_WEBHOOK_KEY_ID } from "./plaid-fake-webhook-key";

describe("Plaid's API", () => {
	it("posts JSON to the environment's host with the client ID and secret in headers", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetcher = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Response.json({ link_token: "link-sandbox-1" });
		}) as unknown as typeof fetch;
		const transport = plaidTransport(
			{ clientId: "client", secret: "secret", environment: "sandbox" },
			fetcher,
		);
		expect(await createLinkToken(transport, "household-1")).toBe("link-sandbox-1");
		const [call] = calls;
		expect(call?.url).toBe("https://sandbox.plaid.com/link/token/create");
		expect(call?.init.headers).toMatchObject({
			"PLAID-CLIENT-ID": "client",
			"PLAID-SECRET": "secret",
		});
		expect(JSON.parse(String(call?.init.body))).toMatchObject({
			user: { client_user_id: "household-1" },
			products: ["transactions"],
			transactions: { days_requested: HISTORY_DAYS },
		});
	});

	it("reports Plaid's error code", async () => {
		const fetcher = (async () =>
			Response.json(
				{ error_code: "INVALID_PUBLIC_TOKEN", error_message: "bad token" },
				{ status: 400 },
			)) as unknown as typeof fetch;
		const transport = plaidTransport(
			{ clientId: "client", secret: "secret", environment: "production" },
			fetcher,
		);
		const error = await transport("/item/public_token/exchange", {}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(BankProviderError);
		expect(error).toMatchObject({ code: "INVALID_PUBLIC_TOKEN", reconnect: false });
	});

	it("keeps what Plaid wrote for the Parent to read, and nothing when it wrote nothing", async () => {
		const answer = (display_message: string | null) =>
			plaidTransport({ clientId: "client", secret: "secret", environment: "sandbox" }, (async () =>
				Response.json(
					{ error_code: "INSTITUTION_DOWN", error_message: "down", display_message },
					{ status: 400 },
				)) as unknown as typeof fetch)("/transactions/sync", {}).catch((e: unknown) => e);
		expect(await answer("This institution is not currently responding.")).toMatchObject({
			notice: "This institution is not currently responding.",
		});
		expect(await answer(null)).toMatchObject({ notice: expect.stringMatching(/isn’t answering/) });
	});

	it("says when a Parent must log in again", async () => {
		const fetcher = (async () =>
			Response.json(
				{ error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" },
				{ status: 400 },
			)) as unknown as typeof fetch;
		const transport = plaidTransport(
			{ clientId: "client", secret: "secret", environment: "sandbox" },
			fetcher,
		);
		const error = await transport("/transactions/sync", {}).catch((e: unknown) => e);
		expect(error).toMatchObject({ code: "ITEM_LOGIN_REQUIRED", reconnect: true });
	});

	it("makes an update-mode link token for the same Item, with the webhook", async () => {
		const bodies: Record<string, unknown>[] = [];
		const transport: PlaidTransport = async (_path, body) => {
			bodies.push(body);
			return { link_token: "link-sandbox-2" };
		};
		await createLinkToken(transport, "household-1", {
			webhook: "https://noodle.example/webhooks/plaid",
			accessToken: "access-1",
		});
		expect(bodies[0]).toMatchObject({
			access_token: "access-1",
			webhook: "https://noodle.example/webhooks/plaid",
		});
		expect(bodies[0]).not.toHaveProperty("products");
	});

	it("hands out the webhook key Plaid names, and none it doesn't", async () => {
		const transport = fakePlaidTransport("2026-09-20");
		expect(await webhookVerificationKey(transport, FAKE_WEBHOOK_KEY_ID)).toMatchObject({
			kty: "EC",
			crv: "P-256",
		});
		expect(await webhookVerificationKey(transport, "other")).toBeNull();
	});
});

describe("Plaid's transactions", () => {
	const added = (id: string) => ({
		transaction_id: id,
		account_id: "acc",
		amount: 10,
		iso_currency_code: "USD",
		date: "2026-09-01",
		name: id,
		pending: false,
	});

	it("restarts a read from its first cursor when the Item changed while paging", async () => {
		const cursors: (string | null)[] = [];
		let failed = false;
		const transport: PlaidTransport = async (_path, body) => {
			const cursor = (body.cursor as string | undefined) ?? null;
			cursors.push(cursor);
			if (cursor === "c1" && !failed) {
				failed = true;
				throw new BankProviderError("mutated", "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
			}
			return cursor === null
				? { added: [added("a")], next_cursor: "c1", has_more: true }
				: {
						added: [added("b")],
						next_cursor: "c2",
						has_more: false,
						transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
					};
		};
		const changes = await plaidProvider(transport).changes("access", null);
		expect(cursors).toEqual([null, "c1", null, "c1"]);
		expect(changes.lines.map((line) => line.bankId)).toEqual(["a", "b"]);
		expect(changes).toMatchObject({ cursor: "c2", complete: true });
	});

	it("isn't complete while Plaid is still gathering history", async () => {
		const transport: PlaidTransport = async () => ({
			added: [],
			next_cursor: "",
			has_more: false,
			transactions_update_status: "NOT_READY",
		});
		expect(await plaidProvider(transport).changes("access", null)).toEqual({
			lines: [],
			removed: [],
			cursor: null,
			complete: false,
		});
	});

	it("reads modified and removed lines, a later page's word on each being the last", async () => {
		const transport: PlaidTransport = async (_path, body) =>
			body.cursor === undefined
				? {
						added: [added("a"), added("b"), { ...added("p"), pending: true }],
						modified: [],
						removed: [],
						next_cursor: "c1",
						has_more: true,
					}
				: {
						added: [{ ...added("t"), pending_transaction_id: "p" }],
						modified: [{ ...added("a"), amount: 12 }],
						removed: [
							{ transaction_id: "b", account_id: "acc" },
							{ transaction_id: "p", account_id: "acc" },
						],
						next_cursor: "c2",
						has_more: false,
					};
		const changes = await plaidProvider(transport).changes("access", null);
		expect(
			changes.lines.map(({ bankId, amount, pending, replaces }) => ({
				bankId,
				amount,
				pending,
				replaces,
			})),
		).toEqual([
			{ bankId: "a", amount: -12_00, pending: false, replaces: null },
			{ bankId: "t", amount: -10_00, pending: false, replaces: "p" },
		]);
		expect(changes.removed).toEqual([
			{ accountExternalId: "acc", bankId: "b" },
			{ accountExternalId: "acc", bankId: "p" },
		]);
	});
});

describe("Plaid in production (#70)", () => {
	const failing = (body: Record<string, unknown>) =>
		plaidTransport({ clientId: "client", secret: "secret", environment: "production" }, (async () =>
			Response.json(body, { status: 400 })) as unknown as typeof fetch)(
			"/transactions/sync",
			{},
		).catch((e: unknown) => e);

	it("asks for a year of history", () => {
		expect(HISTORY_DAYS).toBe(365);
	});

	it("fails closed when the secret doesn't fit the environment", async () => {
		const error = await failing({
			error_type: "INVALID_INPUT",
			error_code: "INVALID_API_KEYS",
			error_message: "invalid client_id or secret provided",
		});
		expect(plaidNotSetUp(error)).toBe(true);
		expect(error).toMatchObject({ notice: expect.stringMatching(/^Plaid isn’t set up/) });
		expect(plaidNotSetUp(new BankProviderError("down", "INSTITUTION_DOWN"))).toBe(false);
		expect(plaidNotSetUp(new Error("INVALID_API_KEYS"))).toBe(false);
	});

	it("says busy banks, limits and unready products in plain words, never Plaid's own", async () => {
		for (const body of [
			{ error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" },
			{ error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_NOT_RESPONDING" },
			{ error_type: "RATE_LIMIT_EXCEEDED", error_code: "TRANSACTIONS_SYNC_LIMIT" },
			{ error_type: "RATE_LIMIT_EXCEEDED", error_code: "RATE_LIMIT_EXCEEDED" },
			{ error_type: "ITEM_ERROR", error_code: "PRODUCT_NOT_READY" },
		]) {
			const error = await failing({
				...body,
				error_message: "raw Plaid text",
				display_message: null,
			});
			expect(error).toBeInstanceOf(BankProviderError);
			const { notice, reconnect } = error as BankProviderError;
			expect(notice).toMatch(/nothing you need to do\.$/);
			expect(notice).not.toContain("raw Plaid text");
			expect(reconnect).toBe(false);
		}
		expect(await failing({ error_code: "A_NEW_CODE", error_message: "raw" })).toMatchObject({
			notice: null,
		});
	});
});

describe("Connect your real bank", () => {
	const off = { status: "disconnected" };
	it("shows once the sandbox is retired and every Bank Connection is disconnected", () => {
		expect(connectRealBankShown("true", [off, off])).toBe(true);
	});
	it("goes once a bank is connected again", () => {
		expect(connectRealBankShown("true", [off, { status: "importing" }])).toBe(false);
		expect(connectRealBankShown("true", [off, { status: "ready" }])).toBe(false);
	});
	it("stays away before the switch, and for a Household that never connected one", () => {
		expect(connectRealBankShown(undefined, [off])).toBe(false);
		expect(connectRealBankShown("false", [off])).toBe(false);
		expect(connectRealBankShown("true", [])).toBe(false);
	});
});
