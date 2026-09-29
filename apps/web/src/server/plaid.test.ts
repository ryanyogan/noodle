import { describe, expect, it } from "vitest";
import { BankProviderError } from "./bank-connection";
import { createLinkToken, type PlaidTransport, plaidProvider, plaidTransport } from "./plaid";

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
			transactions: { days_requested: 90 },
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
		expect(error).toMatchObject({ code: "INVALID_PUBLIC_TOKEN" });
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
			cursor: null,
			complete: false,
		});
	});
});
