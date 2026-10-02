import { describe, expect, it } from "vitest";
import {
	duplicateOf,
	type KnownBank,
	lastUpdatedText,
	linkExitMessage,
	linkTokenExpired,
	sameBank,
} from "../bank-link";
import {
	createLinkToken,
	type PlaidTransport,
	plaidTransport,
	webhookVerificationKey,
} from "./plaid";

describe("linkExitMessage", () => {
	it("says nothing when the Parent simply closed Link", () => {
		expect(linkExitMessage(null, "Chase")).toBeNull();
		expect(linkExitMessage({}, "Chase")).toBeNull();
	});

	it("names the bank that didn't respond, with a way forward", () => {
		expect(
			linkExitMessage(
				{ error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_NOT_RESPONDING" },
				"Chase",
			),
		).toBe("Chase didn’t respond. Try again, or upload a statement instead.");
		expect(
			linkExitMessage({ error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" }, null),
		).toBe("The bank didn’t respond. Try again, or upload a statement instead.");
	});

	it("keeps the statement as a stopgap when reconnecting", () => {
		expect(
			linkExitMessage(
				{ error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" },
				"Chase",
				true,
			),
		).toBe("Chase didn’t respond. Try again, or upload a statement for now.");
	});

	it.each([
		["INVALID_CREDENTIALS", /didn’t accept that login/],
		["INVALID_MFA", /didn’t accept that login/],
		["ITEM_LOCKED", /has locked that login/],
		["USER_SETUP_REQUIRED", /needs something from you first/],
		["ACCESS_NOT_GRANTED", /wasn’t allowed to share/],
		["NO_ACCOUNTS", /no checking, savings, card or loan account/],
		["INSTITUTION_NO_LONGER_SUPPORTED", /can’t be connected right now/],
		["INVALID_LINK_TOKEN", /took too long/],
	])("has plain words for %s", (code, words) => {
		expect(linkExitMessage({ error_type: "ITEM_ERROR", error_code: code }, "Chase")).toMatch(words);
	});

	it("has words for rate limits and for anything it doesn't know", () => {
		expect(
			linkExitMessage({ error_type: "RATE_LIMIT_EXCEEDED", error_code: "RATE_LIMIT" }, "Chase"),
		).toMatch(/Too many tries/);
		expect(
			linkExitMessage({ error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR" }, "Chase"),
		).toMatch(/isn’t working right now/);
	});

	it("never shows Plaid's own codes or text", () => {
		const types = [
			"ITEM_ERROR",
			"INSTITUTION_ERROR",
			"API_ERROR",
			"INVALID_INPUT",
			"SOMETHING_NEW",
		];
		const codes = ["INVALID_CREDENTIALS", "INSTITUTION_DOWN", "PLANNED_MAINTENANCE", "A_NEW_CODE"];
		for (const error_type of types) {
			for (const error_code of codes) {
				const text = linkExitMessage({ error_type, error_code }, "Chase") ?? "";
				expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/);
				expect(text).not.toMatch(/plaid/i);
				expect(text.length).toBeGreaterThan(0);
			}
		}
	});

	it("knows an expired link token", () => {
		expect(
			linkTokenExpired({ error_type: "INVALID_INPUT", error_code: "INVALID_LINK_TOKEN" }),
		).toBe(true);
		expect(linkTokenExpired({ error_code: "INSTITUTION_DOWN" })).toBe(false);
		expect(linkTokenExpired(null)).toBe(false);
	});
});

describe("duplicateOf", () => {
	const chase: KnownBank = {
		connectionId: "c1",
		institutionId: "ins_56",
		institution: "Chase",
		masks: ["0000", "1111", "3333"],
	};

	it("finds the same bank with the same accounts", () => {
		const linked = { institutionId: "ins_56", institution: "Chase", masks: ["1111", "0000"] };
		expect(duplicateOf(linked, [chase])?.connectionId).toBe("c1");
	});

	it("lets another login at the same bank, with other accounts, through", () => {
		const linked = { institutionId: "ins_56", institution: "Chase", masks: ["0000", "9999"] };
		expect(duplicateOf(linked, [chase])).toBeNull();
	});

	it("lets another bank through, whatever its digits", () => {
		const linked = { institutionId: "ins_3", institution: "Citi", masks: ["0000"] };
		expect(duplicateOf(linked, [chase])).toBeNull();
	});

	it("tells the bank by name when a Bank Connection has no institution ID", () => {
		const old = { ...chase, institutionId: null };
		expect(sameBank({ institutionId: "ins_56", institution: " chase " }, old)).toBe(true);
		expect(sameBank({ institutionId: "ins_56", institution: null }, old)).toBe(false);
		// Two IDs that differ aren't the same bank, even under one name.
		expect(sameBank({ institutionId: "ins_57", institution: "Chase" }, chase)).toBe(false);
	});

	it("asks when the digits can't tell", () => {
		const linked = { institutionId: "ins_56", institution: "Chase", masks: [] };
		expect(duplicateOf(linked, [chase])?.connectionId).toBe("c1");
		const unread = { ...chase, connectionId: "c2", masks: null };
		expect(
			duplicateOf({ institutionId: "ins_56", institution: "Chase", masks: ["9999"] }, [unread])
				?.connectionId,
		).toBe("c2");
	});
});

describe("createLinkToken", () => {
	const sent = async (options: Parameters<typeof createLinkToken>[2]) => {
		let body: Record<string, unknown> = {};
		const transport: PlaidTransport = async (_path, sentBody) => {
			body = sentBody;
			return { link_token: "link-sandbox-1" };
		};
		await createLinkToken(transport, "household-1", options);
		return body;
	};

	it("sends the redirect URI, webhook, client name and language", async () => {
		const body = await sent({
			webhook: "https://noodle.example/webhooks/plaid",
			redirectUri: "https://noodle.example/bank/return",
		});
		expect(body).toMatchObject({
			client_name: "Noodle",
			language: "en",
			country_codes: ["US"],
			webhook: "https://noodle.example/webhooks/plaid",
			redirect_uri: "https://noodle.example/bank/return",
			products: ["transactions"],
		});
	});

	it("sends no redirect URI where there's none registered", async () => {
		expect(await sent({ redirectUri: null })).not.toHaveProperty("redirect_uri");
	});

	it("sends it in update mode too", async () => {
		const body = await sent({
			accessToken: "access-1",
			redirectUri: "https://noodle.example/bank/return",
		});
		expect(body).toMatchObject({
			access_token: "access-1",
			redirect_uri: "https://noodle.example/bank/return",
		});
		expect(body).not.toHaveProperty("products");
	});
});

describe("lastUpdatedText", () => {
	const now = Date.parse("2026-09-20T15:00:00Z");
	const minute = 60_000;

	it("says how long ago a Bank Connection was last read", () => {
		expect(lastUpdatedText(now - 20_000, now)).toBe("Last updated just now");
		expect(lastUpdatedText(now - minute, now)).toBe("Last updated 1 minute ago");
		expect(lastUpdatedText(now - 59 * minute, now)).toBe("Last updated 59 minutes ago");
		expect(lastUpdatedText(now - 60 * minute, now)).toBe("Last updated 1 hour ago");
		expect(lastUpdatedText(now - 125 * minute, now)).toBe("Last updated 2 hours ago");
		expect(lastUpdatedText(now - 25 * 60 * minute, now)).toBe("Last updated 1 day ago");
		expect(lastUpdatedText(now - 3 * 24 * 60 * minute, now)).toBe("Last updated 3 days ago");
		// A clock a little behind the server's never says "in the future".
		expect(lastUpdatedText(now + minute, now)).toBe("Last updated just now");
	});
});

describe("Plaid's webhook key under production keys", () => {
	it("comes from Plaid's own /webhook_verification_key/get, not the fake's", async () => {
		const asked: { url: string; body: unknown; secret: string | null }[] = [];
		const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
			asked.push({
				url: String(url),
				body: JSON.parse(String(init?.body)),
				secret: new Headers(init?.headers).get("PLAID-SECRET"),
			});
			return Response.json({
				key: { kty: "EC", crv: "P-256", x: "x", y: "y", kid: "plaid-kid", expired_at: null },
			});
		}) as typeof fetch;
		const transport = plaidTransport(
			{ clientId: "client", secret: "production-secret", environment: "production" },
			fetcher,
		);
		expect(await webhookVerificationKey(transport, "plaid-kid")).toEqual({
			kty: "EC",
			crv: "P-256",
			x: "x",
			y: "y",
		});
		expect(asked).toEqual([
			{
				url: "https://production.plaid.com/webhook_verification_key/get",
				body: { key_id: "plaid-kid" },
				secret: "production-secret",
			},
		]);
	});
});
