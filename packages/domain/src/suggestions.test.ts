import { describe, expect, it } from "vitest";
import {
	addDays,
	type CommitmentNow,
	cadenceOf,
	changedALot,
	type DayKey,
	type SpendLine,
	spotBuckets,
	spotCommitments,
} from "./index";

const today = "2026-10-03" as DayKey;
let n = 0;
const line = (
	daysAgo: number,
	amountCents: number,
	merchant: string,
	more: Partial<SpendLine> = {},
): SpendLine => ({
	id: `t${n++}`,
	date: addDays(today, -daysAgo),
	amountCents,
	merchant,
	owner: null,
	commitmentId: null,
	homeless: true,
	...more,
});

describe("spotBuckets", () => {
	const petco = [80, 72, 60, 45, 33, 20, 12, 5, 2].map((ago) => line(ago, 4_000, "Petco"));

	it("suggests a Bucket for steady, sizeable spending without a home, by kind", () => {
		const [idea] = spotBuckets([...petco, line(40, 2_000, "Chewy")], today, ["Groceries"]);
		expect(idea).toMatchObject({ kind: "new-bucket", name: "Pets", amountCents: 13_000 });
		expect(idea?.evidence.count).toBe(10);
		expect(idea?.evidence.months).toBeGreaterThanOrEqual(3);
	});

	it("names a merchant of no known kind for itself", () => {
		const lines = [85, 60, 30, 3].map((ago) => line(ago, 5_000, "Secret Hobby Shop"));
		expect(spotBuckets(lines, today, [])[0]?.name).toBe("Secret Hobby Shop");
	});

	it("skips spending that's too small, too few, bunched in one month, filed, or already has a Bucket", () => {
		expect(
			spotBuckets(
				petco.map((l) => ({ ...l, amountCents: 1_000 })),
				today,
				[],
			),
		).toEqual([]);
		expect(spotBuckets(petco.slice(0, 3), today, [])).toEqual([]);
		const bunched = [
			line(85, 1_000, "Petco"),
			line(60, 1_000, "Petco"),
			...[10, 11, 12, 13].map((a) => line(a, 9_000, "Petco")),
		];
		expect(spotBuckets(bunched, today, [])).toEqual([]);
		expect(
			spotBuckets(
				petco.map((l) => ({ ...l, homeless: false })),
				today,
				[],
			),
		).toEqual([]);
		expect(spotBuckets(petco, today, ["pets"])).toEqual([]);
	});

	it("never mixes a Parent's Personal Allowance with the Household's spending", () => {
		const mine = petco.map((l) => ({ ...l, owner: "alex" }));
		const ideas = spotBuckets(mine, today, []);
		expect(ideas.map((i) => i.owner)).toEqual(["alex"]);
		const half = petco.map((l, i) => ({ ...l, owner: i % 2 ? "alex" : null }));
		expect(spotBuckets(half, today, []).every((i) => i.evidence.transactionIds.length < 9)).toBe(
			true,
		);
	});
});

describe("cadenceOf", () => {
	const dates = (...ago: number[]) => ago.map((a) => addDays(today, -a));
	it("reads monthly, biweekly and annual runs, and nothing from a noisy one", () => {
		expect(cadenceOf(dates(92, 61, 31, 1))).toBe("monthly");
		expect(cadenceOf(dates(42, 28, 14, 0))).toBe("biweekly");
		expect(cadenceOf(dates(730, 365, 0))).toBe("annual");
		expect(cadenceOf(dates(60, 50, 10, 3))).toBeNull();
		expect(cadenceOf(dates(21, 14, 7, 0))).toBeNull();
	});
});

describe("spotCommitments", () => {
	const gym = [92, 61, 31, 1].map((ago, i) => line(ago, 4_999 + (i % 2) * 100, "Planet Fitness"));

	it("suggests a Commitment for steady recurring charges, with its terms", () => {
		const [idea] = spotCommitments(gym, [], today);
		expect(idea).toMatchObject({
			kind: "new-commitment",
			name: "Planet Fitness",
			cadence: "monthly",
		});
		expect(idea?.kind === "new-commitment" && idea.dueDate).toBe("2026-11-02");
		expect(idea?.evidence.count).toBe(4);
	});

	it("takes 2 charges for annual, 3 otherwise", () => {
		expect(
			spotCommitments([line(366, 9_900, "Costco"), line(1, 9_900, "Costco")], [], today)[0],
		).toMatchObject({ cadence: "annual" });
		expect(spotCommitments(gym.slice(2), [], today)).toEqual([]);
	});

	it("skips amounts that wander, stopped charges, and what's a Commitment already", () => {
		const wander = [92, 61, 31, 1].map((ago, i) => line(ago, 3_000 + i * 1_500, "Comcast"));
		expect(spotCommitments(wander, [], today)).toEqual([]);
		const stopped = [152, 121, 91, 60].map((ago) => line(ago, 5_000, "Hulu"));
		expect(spotCommitments(stopped, [], today)).toEqual([]);
		const paid = gym.map((l) => ({ ...l, commitmentId: "gym" }));
		expect(spotCommitments(paid, [], today)).toEqual([]);
		const named: CommitmentNow = {
			id: "c",
			name: "planet fitness",
			amountCents: 5_000,
			cadence: "monthly",
			dueDate: today,
		};
		expect(spotCommitments(gym, [named], today).filter((i) => i.kind === "new-commitment")).toEqual(
			[],
		);
	});

	it("flags a Commitment whose charges now differ from its amount", () => {
		const netflix: CommitmentNow = {
			id: "nf",
			name: "Netflix",
			amountCents: 1_549,
			cadence: "monthly",
			dueDate: "2026-09-05" as DayKey,
		};
		const charges = [58, 28].map((ago) =>
			line(ago, 1_799, "Netflix", { commitmentId: "nf", homeless: false }),
		);
		expect(spotCommitments(charges, [netflix], today)).toEqual([
			expect.objectContaining({
				kind: "commitment-amount",
				commitmentId: "nf",
				fromCents: 1_549,
				amountCents: 1_799,
			}),
		]);
		const same = charges.map((l) => ({ ...l, amountCents: 1_549 }));
		expect(spotCommitments(same, [netflix], today)).toEqual([]);
		const mine = charges.map((l) => ({ ...l, owner: "alex" }));
		expect(spotCommitments(mine, [netflix], today)).toEqual([]);
	});
});

describe("changedALot", () => {
	const before = { count: 4, amountCents: 10_000, months: 3, transactionIds: [] };
	it("is a 30% move in the amount or twice the charges", () => {
		expect(changedALot(before, { ...before, amountCents: 12_000, count: 6 })).toBe(false);
		expect(changedALot(before, { ...before, amountCents: 13_000 })).toBe(true);
		expect(changedALot(before, { ...before, amountCents: 7_000 })).toBe(true);
		expect(changedALot(before, { ...before, count: 8 })).toBe(true);
	});
});
