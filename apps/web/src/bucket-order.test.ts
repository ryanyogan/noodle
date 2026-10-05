import { describe, expect, it } from "vitest";
import { nudged, placeOf } from "./bucket-order";

describe("nudged", () => {
	const order = ["groceries", "gas", "fun"];

	it("moves a Bucket one place up or down", () => {
		expect(nudged(order, "gas", -1)).toEqual(["gas", "groceries", "fun"]);
		expect(nudged(order, "gas", 1)).toEqual(["groceries", "fun", "gas"]);
	});

	it("leaves the first where it is going up, and the last going down", () => {
		expect(nudged(order, "groceries", -1)).toBe(order);
		expect(nudged(order, "fun", 1)).toBe(order);
	});

	it("leaves the list alone for a Bucket that isn't in it", () => {
		expect(nudged(order, "hockey", 1)).toBe(order);
		expect(nudged([], "hockey", -1)).toEqual([]);
	});

	it("doesn't change the list it was given", () => {
		nudged(order, "fun", -1);
		expect(order).toEqual(["groceries", "gas", "fun"]);
	});
});

describe("placeOf", () => {
	it("says where a Bucket is in the list", () => {
		expect(placeOf(["a", "b", "c"], "b")).toBe("2 of 3");
		expect(placeOf(["a"], "a")).toBe("1 of 1");
	});

	it("says nothing for a Bucket that isn't in it", () => {
		expect(placeOf(["a"], "z")).toBe("");
	});
});
