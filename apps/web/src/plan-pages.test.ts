import { describe, expect, it } from "vitest";
import {
	bucketsListRedirect,
	firstTabHoldsAddress,
	PLAN_BUCKETS_HASH,
	planPageOf,
	planSegment,
} from "./plan-pages";

describe("the Plan's pages", () => {
	it("reads the part of the address after the month", () => {
		expect(planSegment("/plan/2026-10")).toBe("");
		expect(planSegment("/plan/2026-10/")).toBe("");
		expect(planSegment("/plan/2026-10/income")).toBe("income");
		expect(planSegment("/plan/2026-10/buckets/01HZX")).toBe("buckets");
		expect(planSegment("/month/2026-10")).toBe("");
	});

	it("keeps the tab when the month changes, and opens the first page from a Bucket", () => {
		expect(planPageOf("/plan/2026-10")).toBe("/plan/$month");
		expect(planPageOf("/plan/2026-10/income")).toBe("/plan/$month/income");
		expect(planPageOf("/plan/2026-10/commitments/01HZX")).toBe("/plan/$month/commitments");
		expect(planPageOf("/plan/2026-10/goals")).toBe("/plan/$month/goals");
		expect(planPageOf("/plan/2026-10/year")).toBe("/plan/$month/year");
		expect(planPageOf("/plan/2026-10/buckets/01HZX")).toBe("/plan/$month");
		expect(planPageOf("/plan/2026-10/buckets")).toBe("/plan/$month");
		expect(planPageOf("/plan/2026-10/nowhere")).toBe("/plan/$month");
	});

	it("marks the first tab current on a Bucket's address only", () => {
		expect(firstTabHoldsAddress("/plan/2026-10/buckets/01HZX")).toBe(true);
		expect(firstTabHoldsAddress("/plan/2026-10/buckets")).toBe(true);
		// On its own address the link marks itself.
		expect(firstTabHoldsAddress("/plan/2026-10")).toBe(false);
		expect(firstTabHoldsAddress("/plan/2026-10/income")).toBe(false);
		expect(firstTabHoldsAddress("/plan/2026-10/commitments/01HZX")).toBe(false);
	});

	it("sends the old Buckets list address to the Buckets on the first page", () => {
		expect(bucketsListRedirect("2026-10")).toEqual({
			to: "/plan/$month",
			params: { month: "2026-10" },
			hash: "buckets",
		});
		expect(PLAN_BUCKETS_HASH).toBe("buckets");
	});
});
