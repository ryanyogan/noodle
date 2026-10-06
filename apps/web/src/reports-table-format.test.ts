import { describe, expect, it } from "vitest";
import { columnFormatter, type ReportTable } from "./reports";

// One number format down a column of a Reports table (issue 73).
describe("columnFormatter", () => {
	const table: ReportTable = {
		title: "Share of spending",
		columns: [
			{ label: "Where", kind: "text" },
			{ label: "Spent", kind: "money" },
			{ label: "Share", kind: "percent" },
			{ label: "Planned", kind: "money" },
			{ label: "Of plan", kind: "percent" },
		],
		rows: [
			["Mortgage", 1_440_000, 0.38, 240_000, 1],
			["Groceries", 665_662, 0.045, 120_000, 0.92],
			["Health", null, null, null, 0],
		],
	};
	const cells = (i: number) => table.rows.map((row) => columnFormatter(table, i)(row[i] ?? null));

	it("shows cents on every amount when any amount in the column has them", () => {
		expect(cells(1)).toEqual(["$14,400.00", "$6,656.62", "—"]);
	});
	it("keeps whole dollars when every amount in the column is whole", () => {
		expect(cells(3)).toEqual(["$2,400", "$1,200", "—"]);
	});
	it("gives every share a decimal when any share is under 10%", () => {
		expect(cells(2)).toEqual(["38.0%", "4.5%", "—"]);
	});
	it("keeps whole percents when every share is 10% or more", () => {
		expect(cells(4)).toEqual(["100%", "92%", "0%"]);
	});
	it("writes a day key as a date", () => {
		const days: ReportTable = {
			title: "Largest",
			columns: [{ label: "Date", kind: "text" }],
			rows: [["2026-10-05"]],
		};
		expect(columnFormatter(days, 0)("2026-10-05")).toBe("Oct 5, 2026");
	});
	it("leaves text as it is", () => {
		expect(cells(0)).toEqual(["Mortgage", "Groceries", "Health"]);
	});
});
