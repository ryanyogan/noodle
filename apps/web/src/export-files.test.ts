import type { ExportData } from "@noodle/db";
import { describe, expect, it } from "vitest";
import { readyUntil } from "./components/data-download";
import { EXPORT_LIFETIME_MS, exportAvailable, exportFiles } from "./export-files";

const row = (
	over: Partial<ExportData["transactions"][number]>,
): ExportData["transactions"][number] =>
	({
		id: "t",
		date: "2026-09-10",
		amountCents: 1000,
		bucketId: "groceries",
		commitmentId: null,
		goal: null,
		note: null,
		merchantName: null,
		importedFrom: null,
		pending: false,
		matchedIn: null,
		transfer: null,
		refundOf: null,
		for: [],
		splits: [],
		partlyPrivate: false,
		autoFiled: null,
		...over,
	}) as ExportData["transactions"][number];

const data = (over: Partial<ExportData> = {}): ExportData => ({
	household: { id: "h", name: "The Rinks" },
	viewer: { id: "alex", name: "Alex" },
	exportedAt: 0,
	members: [
		{ id: "alex", name: "Alex", kind: "parent", color: null, removed: false },
		{ id: "sam", name: "Sam", kind: "parent", color: null, removed: false },
		{ id: "kid", name: "Robin", kind: "child", color: 1, removed: false },
	] as ExportData["members"],
	accounts: [],
	transactions: [],
	privateTotals: [],
	plans: [],
	goals: [],
	bucketNames: { groceries: "Groceries", fun: "Sam’s Personal Allowance" },
	commitmentNames: {},
	planChanges: [],
	rules: [],
	owedBack: [],
	paidBackMatches: [],
	files: [],
	...over,
});

/** A minimal CSV reader: enough to check what a spreadsheet would read back. */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(cell);
			cell = "";
		} else if (c === "\r" && text[i + 1] === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			i++;
		} else cell += c;
	}
	return rows;
}

describe("exportFiles", () => {
	it("escapes quotes, commas and newlines, and guards cells a spreadsheet would run", () => {
		const files = exportFiles(
			data({
				transactions: [
					row({ id: "a", note: 'Dinner, "the good place"\nwith Robin', for: ["kid"] }),
					row({ id: "b", note: '=HYPERLINK("evil")', merchantName: "@Costco" }),
					row({ id: "c", note: "+1 refund", amountCents: -250 }),
				],
			}),
		);
		const rows = parseCsv(files["transactions.csv"] as string);
		expect(rows[0]).toEqual([
			"Date",
			"Account",
			"Merchant",
			"Note",
			"Amount",
			"Bucket",
			"Commitment",
			"Goal",
			"Splits",
			"For",
		]);
		expect(rows[1]?.[3]).toBe('Dinner, "the good place"\nwith Robin');
		expect(rows[1]?.[9]).toBe("Robin");
		expect(rows[2]?.[2]).toBe("'@Costco");
		expect(rows[2]?.[3]).toBe('\'=HYPERLINK("evil")');
		expect(rows[3]?.[3]).toBe("'+1 refund");
		// Money stays a number, so a refund's minus sign isn't guarded.
		expect(rows[3]?.[4]).toBe("-2.5");
		expect(rows.every((r) => r.length === 10)).toBe(true);
	});

	it("re-totals each Bucket's month, with the other Parent's Personal Allowance only as its total", () => {
		const files = exportFiles(
			data({
				transactions: [
					row({ id: "a", amountCents: 4210 }),
					row({ id: "b", amountCents: 1790, date: "2026-09-20" }),
					row({
						id: "c",
						amountCents: 3000,
						bucketId: null,
						splits: [
							{
								id: "s1",
								amountCents: 2000,
								bucketId: "groceries",
								commitmentId: null,
								goal: null,
								for: [],
							},
							{
								id: "s2",
								amountCents: 1000,
								bucketId: "groceries",
								commitmentId: null,
								goal: null,
								for: ["kid"],
							},
						],
					}),
				],
				privateTotals: [{ bucketId: "fun", month: "2026-09", amountCents: 12_345 }],
			}),
		);
		const rows = parseCsv(files["transactions.csv"] as string).slice(1);
		const total = (bucket: string) =>
			rows.reduce((sum, r) => {
				if (r[5] === bucket) return sum + Number(r[4]);
				const splits = (r[8] ?? "").split("; ").filter((s) => s.startsWith(`${bucket} `));
				return sum + splits.reduce((s, part) => s + Number(part.split(" ")[1]), 0);
			}, 0);
		expect(total("Groceries")).toBeCloseTo(90);
		expect(total("Sam’s Personal Allowance")).toBeCloseTo(123.45);
		const privateRow = rows.find((r) => r[5] === "Sam’s Personal Allowance");
		expect(privateRow?.[0]).toBe("2026-09-01");
		expect(privateRow?.[2]).toBe("");
		expect(JSON.parse(files["household.json"] as string).privateTotals).toHaveLength(1);
	});

	it("writes every file the ZIP holds", () => {
		expect(Object.keys(exportFiles(data())).sort()).toEqual([
			"accounts.csv",
			"household.json",
			"owed-back.csv",
			"plan-changes.csv",
			"plan.csv",
			"rules.csv",
			"transactions.csv",
		]);
	});
});

describe("exportAvailable", () => {
	const alex = { householdId: "h", memberId: "alex" };
	const meta = { householdId: "h", memberId: "alex", expiresAt: String(1000 + EXPORT_LIFETIME_MS) };
	it("lets its own Parent download it until it expires", () => {
		expect(exportAvailable(meta, alex, 1000)).toBe(true);
		expect(exportAvailable(meta, alex, 1000 + EXPORT_LIFETIME_MS - 1)).toBe(true);
		expect(exportAvailable(meta, alex, 1000 + EXPORT_LIFETIME_MS)).toBe(false);
	});
	it("refuses the other Parent, another Household, and a download with no expiry", () => {
		expect(exportAvailable(meta, { householdId: "h", memberId: "sam" }, 1000)).toBe(false);
		expect(exportAvailable(meta, { householdId: "other", memberId: "alex" }, 1000)).toBe(false);
		expect(exportAvailable({ householdId: "h", memberId: "alex" }, alex, 1000)).toBe(false);
		expect(exportAvailable(undefined, alex, 1000)).toBe(false);
	});
	it("says when it's ready until in plain words", () => {
		const now = new Date(2026, 9, 3, 15, 40);
		expect(readyUntil(now.getTime() + EXPORT_LIFETIME_MS, now)).toBe("3:40 PM tomorrow");
	});
});
