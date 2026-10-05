import { describe, expect, it } from "vitest";
import { foldSnapshots } from "./snapshot-fold";

describe("foldSnapshots", () => {
	it("has no row and no button when there are no snapshots", () => {
		expect(foldSnapshots([], false)).toEqual({ latest: null, earlier: [], label: null });
		expect(foldSnapshots([], true)).toEqual({ latest: null, earlier: [], label: null });
	});

	it("shows the one snapshot and no button when there is only one", () => {
		expect(foldSnapshots(["a"], false)).toEqual({ latest: "a", earlier: [], label: null });
		// Left open from when there were more: still nothing to unfold.
		expect(foldSnapshots(["a"], true)).toEqual({ latest: "a", earlier: [], label: null });
	});

	it("shows only the newest at rest, with the count of all of them on the button", () => {
		expect(foldSnapshots(["c", "b", "a"], false)).toEqual({
			latest: "c",
			earlier: [],
			label: "Show all 3 snapshots",
		});
		expect(foldSnapshots(["b", "a"], false).label).toBe("Show all 2 snapshots");
	});

	it("shows the rest, in the order given, when open", () => {
		expect(foldSnapshots(["c", "b", "a"], true)).toEqual({
			latest: "c",
			earlier: ["b", "a"],
			label: "Show fewer",
		});
	});

	it("keeps the newest first even when it can't be restored", () => {
		const list = [
			{ id: "new", restorable: false },
			{ id: "old", restorable: true },
		];
		expect(foldSnapshots(list, false).latest?.id).toBe("new");
		expect(foldSnapshots(list, true).earlier.map((s) => s.id)).toEqual(["old"]);
	});

	it("moves to a newer snapshot and counts it when one arrives", () => {
		expect(foldSnapshots(["b", "a"], false)).toMatchObject({ latest: "b" });
		expect(foldSnapshots(["c", "b", "a"], false)).toMatchObject({
			latest: "c",
			label: "Show all 3 snapshots",
		});
	});
});
