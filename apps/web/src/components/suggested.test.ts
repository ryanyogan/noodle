import { describe, expect, it } from "vitest";
import { stillOpen } from "./suggested";

// Which suggestions a page shows while decisions are on their way (#76).
describe("stillOpen", () => {
	const items = [
		{ id: "gym", kind: "new-commitment" as const },
		{ id: "music", kind: "new-commitment" as const },
		{ id: "widgets", kind: "rule" as const },
	];
	const ids = (pending: string[], kinds?: ("new-commitment" | "rule")[]) =>
		stillOpen(items, kinds, new Set(pending)).map((item) => item.id);

	it("keeps only the page's kinds", () => {
		expect(ids([], ["new-commitment"])).toEqual(["gym", "music"]);
		expect(ids([])).toEqual(["gym", "music", "widgets"]);
	});

	it("hides every row with a decision on its way, not only the latest", () => {
		expect(ids(["gym", "music"], ["new-commitment"])).toEqual([]);
	});

	it("shows a row again once its own decision is no longer on its way", () => {
		expect(ids(["music"], ["new-commitment"])).toEqual(["gym"]);
	});
});
