import { describe, expect, it } from "vitest";
import {
	claimUrlOf,
	INVALID_SETUP_TOKEN,
	SETUP_TOKEN_CLAIMED,
	type SimplefinTransport,
	simplefinProvider,
	simplefinTransport,
} from "./simplefin";
import { fakeSetupToken, fakeSimplefinTransport } from "./simplefin-fake";

// SimpleFIN's transport and reads, apart from the Workflow: what goes over the wire, and how a
// read spans the Bridge's 90 days.

const CLAIM_URL = "https://beta-bridge.simplefin.org/simplefin/claim/DEMO-v2-60D229BFE4E46BCCB323";
const ACCESS_URL = "https://demo%40user:p%3Ass@beta-bridge.simplefin.org/simplefin";
const DAY = 86_400;

type Call = { url: string; init: RequestInit | undefined };

function fetchWith(respond: (url: string) => Response) {
	const calls: Call[] = [];
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		return respond(url);
	}) as typeof fetch;
	return { calls, fetcher };
}

describe("claimUrlOf", () => {
	it("reads the claim URL out of a setup token", () => {
		expect(claimUrlOf(` ${btoa(CLAIM_URL)}\n`)).toBe(CLAIM_URL);
	});

	it("refuses anything else", () => {
		for (const token of ["not a token", btoa("hello"), btoa("http://example.com/claim/x")]) {
			expect(() => claimUrlOf(token)).toThrow(
				expect.objectContaining({ code: INVALID_SETUP_TOKEN }),
			);
		}
	});
});

describe("simplefinTransport", () => {
	it("claims with an empty POST and answers the Access URL", async () => {
		const { calls, fetcher } = fetchWith(() => new Response(`${ACCESS_URL}\n`));
		expect(await simplefinTransport(fetcher).claim(CLAIM_URL)).toBe(ACCESS_URL);
		expect(calls).toEqual([{ url: CLAIM_URL, init: { method: "POST" } }]);
	});

	it("says a setup token was claimed already when the claim is refused", async () => {
		const { fetcher } = fetchWith(() => new Response("Forbidden", { status: 403 }));
		await expect(simplefinTransport(fetcher).claim(CLAIM_URL)).rejects.toMatchObject({
			code: SETUP_TOKEN_CLAIMED,
		});
	});

	it("reads the accounts with the Access URL's credentials as Basic Auth, not in the URL", async () => {
		const { calls, fetcher } = fetchWith(() => Response.json({ errlist: [], accounts: [] }));
		await simplefinTransport(fetcher).accounts(
			ACCESS_URL,
			new URLSearchParams({ "start-date": "1789000000" }),
		);
		expect(calls[0]?.url).toBe(
			"https://beta-bridge.simplefin.org/simplefin/accounts?start-date=1789000000",
		);
		expect(calls[0]?.init?.headers).toMatchObject({
			Authorization: `Basic ${btoa("demo@user:p:ss")}`,
		});
	});

	it("fails a read the Bridge refuses", async () => {
		const { fetcher } = fetchWith(() => new Response("Forbidden", { status: 403 }));
		await expect(
			simplefinTransport(fetcher).accounts(ACCESS_URL, new URLSearchParams()),
		).rejects.toMatchObject({ code: "403" });
	});
});

describe("simplefinProvider's reads", () => {
	const now = new Date("2026-09-20T15:00:00Z");
	const until = now.getTime() / 1000;

	function spying() {
		const queries: URLSearchParams[] = [];
		const transport: SimplefinTransport = {
			claim: async () => ACCESS_URL,
			accounts: async (_accessUrl, query) => {
				queries.push(query);
				return { errlist: [], accounts: [] };
			},
		};
		return { queries, provider: simplefinProvider(transport, () => now) };
	}

	it("reads up to now, and says so in the cursor", async () => {
		const { queries, provider } = spying();
		expect(await provider.changes(ACCESS_URL, String(until - 2 * DAY))).toEqual({
			lines: [],
			cursor: String(until),
			complete: true,
			notice: null,
		});
		expect(Object.fromEntries(queries[0] ?? [])).toEqual({
			"start-date": String(until - 7 * DAY),
		});
	});

	it("reads at most 89 days at once, and the rest next time", async () => {
		const { queries, provider } = spying();
		const long = until - 200 * DAY;
		const first = await provider.changes(ACCESS_URL, String(long));
		expect(first).toMatchObject({ cursor: String(long - 5 * DAY + 89 * DAY), complete: false });
		expect(Object.fromEntries(queries[0] ?? [])).toEqual({
			"start-date": String(long - 5 * DAY),
			"end-date": String(long - 5 * DAY + 89 * DAY),
		});
	});

	it("connects a fake Bridge login, and refuses its claimed tokens", async () => {
		const provider = simplefinProvider(fakeSimplefinTransport("2026-09-20"), () => now);
		const link = await provider.connect({ token: fakeSetupToken("household"), institution: null });
		expect(link.institution).toBe("Prairie State Credit Union");
		expect(link.externalId).toMatch(/^[0-9a-f]{32}$/);
		expect((await provider.accounts(link.credential)).filter((a) => a.kind)).toHaveLength(4);
		await expect(
			provider.connect({ token: fakeSetupToken("USED-1"), institution: null }),
		).rejects.toMatchObject({ code: SETUP_TOKEN_CLAIMED });
	});
});
