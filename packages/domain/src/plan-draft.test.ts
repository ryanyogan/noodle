import { describe, expect, it } from "vitest";
import {
	addDays,
	type DayKey,
	type DraftHistory,
	type DraftIncome,
	detectCommitments,
	detectPaychecks,
	draftFindings,
	draftIsEmpty,
	draftPlan,
	type InsightSpend,
	noDraftLabels,
	plainName,
	suggestBuckets,
} from "./index";

const through = "2026-09-25" as DayKey;

let ids = 0;
const spend = (
	note: string,
	dollars: number,
	date: string,
	extra: Partial<InsightSpend> = {},
): InsightSpend => ({
	id: `t${String(++ids).padStart(4, "0")}`,
	date: date as DayKey,
	amount: Math.round(dollars * 100),
	note,
	commitmentId: null,
	private: false,
	...extra,
});

const deposit = (note: string, dollars: number, date: string): DraftIncome => ({
	id: `i${String(++ids).padStart(4, "0")}`,
	date: date as DayKey,
	amount: Math.round(dollars * 100),
	note,
});

/** `dollars` at `note` every `days` days, going back from `last`, `times` times. */
const every = <T>(
	make: (note: string, dollars: number, date: string) => T,
	note: string,
	dollars: number,
	last: string,
	days: number,
	times: number,
): T[] =>
	Array.from({ length: times }, (_, i) =>
		make(note, dollars, addDays(last as DayKey, -days * (times - 1 - i))),
	);

/** About three months of a family's history, from the 1st of July to the 25th of September. */
function history(): DraftHistory {
	return {
		income: [
			// Paid every two weeks, the amount varying a little with overtime.
			deposit("ACME CORP PAYROLL", 2400, "2026-07-03"),
			deposit("ACME CORP PAYROLL", 2400, "2026-07-17"),
			deposit("ACME CORP PAYROLL", 2512.5, "2026-07-31"),
			deposit("ACME CORP PAYROLL", 2400, "2026-08-14"),
			deposit("ACME CORP PAYROLL", 2400, "2026-08-28"),
			deposit("ACME CORP PAYROLL", 2400, "2026-09-11"),
			deposit("ACME CORP PAYROLL", 2400, "2026-09-25"),
			// Once, not a paycheck.
			deposit("IRS TREAS 310 TAX REF", 1200, "2026-08-02"),
			// Small and monthly: interest, not pay.
			deposit("INTEREST PAYMENT", 1.2, "2026-07-31"),
			deposit("INTEREST PAYMENT", 1.3, "2026-08-31"),
		],
		spends: [
			spend("ROCKET MORTGAGE", 2400, "2026-07-01"),
			spend("ROCKET MORTGAGE", 2400, "2026-08-01"),
			spend("ROCKET MORTGAGE", 2400, "2026-09-01"),
			spend("NETFLIX.COM", 15.49, "2026-07-12"),
			spend("NETFLIX.COM", 15.49, "2026-08-12"),
			spend("NETFLIX.COM", 17.99, "2026-09-12"),
			...every(spend, "BRIGHT HORIZONS DAYCARE", 610, "2026-09-18", 14, 6),
			...every(spend, "COSTCO WHSE #0123", 180, "2026-09-24", 7, 12),
			...every(spend, "CHIPOTLE 1234", 30, "2026-09-20", 10, 8),
			spend("SHELL OIL 57444", 52, "2026-07-09"),
			spend("SHELL OIL 57444", 48, "2026-07-25"),
			spend("SHELL OIL 57444", 55, "2026-08-19"),
			spend("SHELL OIL 57444", 51, "2026-09-15"),
			spend("CORNER BOOKSHOP", 12, "2026-08-08"),
			spend("HOME DEPOT 4410", 212, "2026-07-20"),
		],
	};
}

describe("detectPaychecks", () => {
	it("finds a biweekly paycheck and takes it as two a month", () => {
		const [paycheck, ...rest] = detectPaychecks(history().income, through);
		expect(rest).toEqual([]);
		expect(paycheck).toMatchObject({
			key: "acme corp payroll",
			amount: 240000,
			cadence: "biweekly",
			monthly: 480000,
		});
		expect(paycheck?.dates).toHaveLength(7);
	});

	it("takes paydays twice a month as two a month, and monthly as one", () => {
		const income = [
			deposit("CITY OF PORTLAND PAYROLL", 1800, "2026-07-15"),
			deposit("CITY OF PORTLAND PAYROLL", 1800, "2026-07-31"),
			deposit("CITY OF PORTLAND PAYROLL", 1800, "2026-08-14"),
			deposit("CITY OF PORTLAND PAYROLL", 1800, "2026-08-31"),
			deposit("CITY OF PORTLAND PAYROLL", 1800, "2026-09-15"),
			deposit("STATE PENSION", 900, "2026-07-01"),
			deposit("STATE PENSION", 900, "2026-08-01"),
			deposit("STATE PENSION", 900, "2026-09-01"),
		];
		expect(detectPaychecks(income, through).map((p) => [p.key, p.cadence, p.monthly])).toEqual([
			["city of portland payroll", "biweekly", 360000],
			["state pension", "monthly", 90000],
		]);
	});

	it("drops a payer that stopped paying, or pays at no steady interval", () => {
		const stopped = [
			deposit("OLD JOB PAYROLL", 2000, "2026-06-05"),
			deposit("OLD JOB PAYROLL", 2000, "2026-06-19"),
			deposit("OLD JOB PAYROLL", 2000, "2026-07-03"),
		];
		const irregular = [
			deposit("FREELANCE CLIENT", 1500, "2026-07-02"),
			deposit("FREELANCE CLIENT", 1500, "2026-07-09"),
			deposit("FREELANCE CLIENT", 1500, "2026-09-01"),
		];
		expect(detectPaychecks([...stopped, ...irregular], through)).toEqual([]);
	});
});

describe("detectCommitments", () => {
	it("finds monthly and biweekly charges, not weekly shops or the odd purchase", () => {
		const found = detectCommitments(history().spends, through);
		expect(found.map((c) => [c.key, c.cadence, c.amount, c.dueDate])).toEqual([
			["rocket mortgage", "monthly", 240000, "2026-09-01"],
			["bright horizons daycare", "biweekly", 61000, "2026-09-18"],
			["netflix", "monthly", 1799, "2026-09-12"],
		]);
		expect(found[1]?.transactionIds).toHaveLength(6);
	});

	it("leaves out charges already paying a Commitment, and private spending", () => {
		const spends = [
			spend("ROCKET MORTGAGE", 2400, "2026-08-01", { commitmentId: "mortgage" }),
			spend("ROCKET MORTGAGE", 2400, "2026-09-01", { commitmentId: "mortgage" }),
			spend("GOLF CLUB", 90, "2026-08-03", { private: true }),
			spend("GOLF CLUB", 90, "2026-09-03", { private: true }),
		];
		expect(detectCommitments(spends, through)).toEqual([]);
	});
});

describe("draftFindings", () => {
	it("reads history up to its latest day, three months at most", () => {
		expect(draftFindings(history())).toMatchObject({
			from: "2026-07-01",
			through: "2026-09-25",
			days: 87,
		});
		const longer = history();
		longer.spends.push(spend("COSTCO WHSE #0123", 180, "2026-04-02"));
		expect(draftFindings(longer)).toMatchObject({
			from: "2026-06-27",
			through: "2026-09-25",
			days: 91,
		});
	});

	it("needs about a month of history", () => {
		const short = {
			spends: [spend("COSTCO", 100, "2026-09-01"), spend("COSTCO", 100, "2026-09-20")],
			income: [],
		};
		expect(draftFindings(short)).toBeNull();
		expect(draftFindings({ spends: [], income: [] })).toBeNull();
	});

	it("counts everyday spending by merchant, leaving out the Commitments found", () => {
		const findings = draftFindings(history());
		expect(findings?.merchants.map((m) => [m.key, m.total, m.count])).toEqual(
			[
				["costco whse", 216000, 12],
				["chipotle", 24000, 8],
				["shell oil", 20600, 4],
				["home depot", 21200, 1],
				["corner bookshop", 1200, 1],
			].sort((a, b) => (b[1] as number) - (a[1] as number)),
		);
	});
});

describe("suggestBuckets", () => {
	const labels = {
		buckets: {
			"costco whse": "Groceries",
			chipotle: "Eating out",
			"shell oil": "Gas",
			"home depot": "Home",
			"corner bookshop": "Fun",
		},
		names: { "costco whse": "Costco" },
	};

	it("gives each Bucket its average month, rounded up to tens of dollars", () => {
		const findings = draftFindings(history());
		if (!findings) throw new Error("no findings");
		const buckets = suggestBuckets(findings, labels);
		// Costco: $2,160 over 87 days is $755.69 in an average month (30.44 days).
		expect(buckets.map((b) => [b.name, b.allowance, b.monthly])).toEqual([
			["Groceries", 76000, 75569],
			["Eating out", 9000, 8397],
			["Gas", 8000, 7207],
			["Home", 8000, 7417],
			// The bookshop, $4.20 a month on its own, folds into Everyday.
			["Everyday", 1000, 420],
		]);
		expect(buckets[0]?.merchants).toEqual(["Costco"]);
	});

	it("puts everything in Everyday until a model has named Buckets", () => {
		const findings = draftFindings(history());
		if (!findings) throw new Error("no findings");
		const buckets = suggestBuckets(findings, noDraftLabels);
		expect(buckets.map((b) => [b.key, b.name, b.allowance])).toEqual([
			["bucket:everyday", "Everyday", 100000],
		]);
		expect(buckets[0]?.merchants).toEqual([
			"Costco Whse",
			"Chipotle",
			"Home Depot",
			"Shell Oil",
			"Corner Bookshop",
		]);
	});
});

describe("draftPlan", () => {
	const findings = draftFindings(history());
	if (!findings) throw new Error("no findings");
	const empty = { baseline: null, commitments: [], buckets: [] };

	it("drafts a Baseline, Commitments and Buckets, named by the model where it did", () => {
		const draft = draftPlan(
			findings,
			{
				buckets: { "costco whse": "Groceries" },
				names: { netflix: "Netflix", "acme corp payroll": "Acme" },
			},
			empty,
			new Set(),
		);
		expect(draft.baseline).toMatchObject({ key: "baseline", amount: 480000 });
		expect(draft.baseline?.paychecks.map((p) => p.name)).toEqual(["Acme"]);
		expect(draft.commitments.map((c) => [c.key, c.name])).toEqual([
			["commitment:rocket mortgage", "Rocket Mortgage"],
			["commitment:bright horizons daycare", "Bright Horizons Daycare"],
			["commitment:netflix", "Netflix"],
		]);
		expect(draft.buckets.map((b) => b.key)).toEqual(["bucket:groceries", "bucket:everyday"]);
		expect(draftIsEmpty(draft)).toBe(false);
	});

	it("leaves out what was decided and what the Plan already has", () => {
		const draft = draftPlan(
			findings,
			noDraftLabels,
			{ baseline: 500000, commitments: [{ name: "Netflix" }], buckets: [{ name: "everyday" }] },
			new Set(["commitment:rocket mortgage"]),
		);
		expect(draft.baseline).toBeNull();
		expect(draft.commitments.map((c) => c.key)).toEqual(["commitment:bright horizons daycare"]);
		expect(draft.buckets).toEqual([]);
		const done = draftPlan(
			findings,
			noDraftLabels,
			empty,
			new Set([
				"baseline",
				"commitment:bright horizons daycare",
				"commitment:rocket mortgage",
				"commitment:netflix",
				"bucket:everyday",
			]),
		);
		expect(draftIsEmpty(done)).toBe(true);
	});
});

describe("plainName", () => {
	it("reads a statement line as a name", () => {
		expect(plainName("TRADER JOE'S #552   PORTLAND OR")).toBe("Trader Joe's Portland");
		expect(plainName("NETFLIX.COM")).toBe("Netflix");
	});
});
