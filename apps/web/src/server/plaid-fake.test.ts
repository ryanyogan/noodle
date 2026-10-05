import type { DayKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { createLinkToken, plaidProvider } from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";

// The fake Plaid honours a link's `days_requested` (#89), carried on its tokens, and still sends
// one far older line, as a bank that ignores the span would.

const today = "2026-09-20" as DayKey;
const fake = fakePlaidTransport(today);
const ids = async (accessToken: string) => {
	const provider = plaidProvider(fake);
	const first = await provider.changes(accessToken, null);
	return { ids: first.lines.map((line) => line.bankId).sort(), complete: first.complete };
};

describe("the fake Plaid and days_requested", () => {
	it("carries a new link's days from the link token to the access token, on the same Item", async () => {
		expect(await createLinkToken(fake, "h", { historyDays: 90 })).toBe("link-fake-h~d90");
		expect(
			await plaidProvider(fake).connect({ token: "public-fake-h~d90", institution: null }),
		).toEqual({ credential: "access-fake-h~d90", externalId: "item-fake-h", institution: null });
		// Update mode asks for no days: the Item has its span already.
		expect(
			await createLinkToken(fake, "h", { accessToken: "access-fake-h~d90", historyDays: 30 }),
		).toBe("link-fake-update-h");
	});

	it("hands over the lines inside the span, and one far older regardless", async () => {
		const ninety = await ids("access-fake-h~d90");
		expect(ninety.complete).toBe(true);
		expect(ninety.ids).toContain("fake-old1");
		expect(ninety.ids).not.toContain("fake-old2");
		expect(ninety.ids).toContain("fake-old3");
		expect(ninety.ids).toContain("fake-t10");

		const five = await ids("access-fake-h~d5");
		expect(five.complete).toBe(true);
		expect(five.ids).toEqual(
			["fake-old3", "fake-t1", "fake-t2", "fake-t3", "fake-t4", "fake-t5", "fake-t6"].sort(),
		);

		const year = await ids("access-fake-h~d365");
		expect(year.ids).toEqual(expect.arrayContaining(["fake-old1", "fake-old2", "fake-old3"]));
	});

	it("reads as it always has for a token that names no days", async () => {
		const plain = await ids("access-fake-h");
		expect(plain.ids).toHaveLength(10);
		expect(plain.ids.some((id) => id.startsWith("fake-old"))).toBe(false);
	});
});
