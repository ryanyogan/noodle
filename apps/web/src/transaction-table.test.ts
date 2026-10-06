import { describe, expect, it } from "vitest";
import { editsInCell, escapeStep, openPlace } from "./transaction-table";

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
