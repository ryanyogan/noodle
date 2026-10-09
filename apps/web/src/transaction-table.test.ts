import type { DayKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { dayTotals, editsInCell, escapeStep, openPlace } from "./transaction-table";

// Esc on the Transactions page steps back one thing at a time (issue 99).
describe("escapeStep", () => {
	const nothing = { overlay: false, typing: false, open: false, selecting: false };

	it("leaves Esc to a menu, a picker or a sheet that is open", () => {
		expect(escapeStep({ ...nothing, overlay: true, open: true, selecting: true })).toBe("nothing");
	});

	it("closes the open Transaction before it ends the selection", () => {
		expect(escapeStep({ ...nothing, open: true, selecting: true })).toBe("close");
		expect(escapeStep({ ...nothing, open: true, typing: true })).toBe("close");
	});

	it("ends the selection when nothing else is open", () => {
		expect(escapeStep({ ...nothing, selecting: true })).toBe("unselect");
	});

	it("doesn't end the selection from a field being typed in, and does nothing with nothing to step back from", () => {
		expect(escapeStep({ ...nothing, selecting: true, typing: true })).toBe("nothing");
		expect(escapeStep(nothing)).toBe("nothing");
	});
});

// A row open in place, another row's cell being edited, and rows ticked (issue 99): one Esc each.
describe("escapeStep with a row open in place", () => {
	const all = { overlay: false, typing: true, open: true, selecting: true };

	it("gives up another row's cell edit first, then closes the open row, then ends the selection", () => {
		expect(escapeStep({ ...all, cell: true })).toBe("cell");
		expect(escapeStep({ ...all, cell: false })).toBe("close");
		expect(escapeStep({ ...all, typing: false, open: false })).toBe("unselect");
	});

	it("closes the open row from a field of its own editor, which is not a cell", () => {
		expect(escapeStep({ overlay: false, typing: true, open: true, selecting: false })).toBe(
			"close",
		);
	});
});

describe("openPlace", () => {
	const loaded = [{ id: "a" }, { id: "b" }];

	it("is under its own row when the list has loaded it", () => {
		expect(openPlace("b", loaded)).toBe("row");
	});

	it("is the table's first row when its address is open and the list hasn't loaded it", () => {
		expect(openPlace("z", loaded)).toBe("top");
		expect(openPlace("z", [])).toBe("top");
	});

	it("is nowhere with no Transaction open", () => {
		expect(openPlace(undefined, loaded)).toBe("none");
	});
});

describe("editsInCell", () => {
	it("leaves the open row's cells to its editor; other rows still edit in the cell", () => {
		expect(editsInCell("a", "a")).toBe(false);
		expect(editsInCell("b", "a")).toBe(true);
		expect(editsInCell("a", undefined)).toBe(true);
	});
});

describe("dayTotals", () => {
	const owedBack = [{ who: "Casey", owed: 30_000, paid: 0 }];
	const bought = (date: string, amountCents: number, more: object = {}) => ({
		date: date as DayKey,
		amountCents,
		transfer: null,
		moneyIn: undefined,
		...more,
	});

	it("leaves the Owed back part out of a day from October 1, 2026 on, as the month does", () => {
		const totals = dayTotals(
			[bought("2026-10-01", 60_000, { owedBack }), bought("2026-10-01", 2_500)],
			false,
		);
		expect(totals.get("2026-10-01" as DayKey)).toBe(32_500);
	});

	it("leaves it out whether or not it has been Paid back", () => {
		const paid = [{ who: "Casey", owed: 30_000, paid: 30_000 }];
		expect(
			dayTotals([bought("2026-10-01", 60_000, { owedBack: paid })], false).get(
				"2026-10-01" as DayKey,
			),
		).toBe(30_000);
	});

	it("counts an earlier purchase whole, as its month was counted", () => {
		expect(
			dayTotals([bought("2026-09-30", 60_000, { owedBack })], false).get("2026-09-30" as DayKey),
		).toBe(60_000);
	});
});
