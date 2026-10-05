import { extendIds } from "@noodle/ui/lib/data-table";
import { describe, expect, it } from "vitest";

// Shift+Up and Shift+Down in a working table (issue 99): the selection follows the focus.
describe("extendIds", () => {
	const rows = ["a", "b", "c", "d", "e"];

	it("starts from the row the focus leaves when nothing was ticked before", () => {
		expect(extendIds(rows, null, "b", "c")).toEqual({
			anchor: { id: "b", on: true },
			ids: ["b", "c"],
			on: true,
		});
	});

	it("gives the rows from the anchor to the new row the anchor's state", () => {
		const anchor = { id: "b", on: true };
		expect(extendIds(rows, anchor, "c", "d")).toEqual({ anchor, ids: ["b", "c", "d"], on: true });
		expect(extendIds(rows, anchor, "b", "a")).toEqual({ anchor, ids: ["a", "b"], on: true });
		const off = { id: "d", on: false };
		expect(extendIds(rows, off, "d", "e")).toEqual({ anchor: off, ids: ["d", "e"], on: false });
	});

	it("gives up the row left behind on the way back to the anchor", () => {
		const anchor = { id: "b", on: true };
		expect(extendIds(rows, anchor, "d", "c")).toEqual({ anchor, ids: ["d"], on: false });
		expect(extendIds(rows, { id: "d", on: true }, "b", "c")).toEqual({
			anchor: { id: "d", on: true },
			ids: ["b"],
			on: false,
		});
	});

	it("selects nothing when the new row can't be selected, and starts there when the old one can't", () => {
		expect(extendIds(rows, null, "b", "goal")).toBeNull();
		expect(extendIds(rows, null, "goal", "c")).toEqual({
			anchor: { id: "c", on: true },
			ids: ["c"],
			on: true,
		});
	});

	it("starts again when the anchor has left the list", () => {
		expect(extendIds(rows, { id: "gone", on: true }, "c", "d")).toEqual({
			anchor: { id: "c", on: true },
			ids: ["c", "d"],
			on: true,
		});
	});
});
