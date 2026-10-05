import { describe, expect, it } from "vitest";
import {
	anyPicked,
	canPick,
	headerCheckOf,
	isPicked,
	nothingPicked,
	pickAll,
	selectAllLabel,
	setPicked,
} from "./transaction-selection";

// The Transactions table's checkboxes over 97a's selection (issue 99).
describe("setPicked", () => {
	it("ticks and unticks a run of Transactions picked one by one", () => {
		const three = setPicked(nothingPicked, ["a", "b", "c"], true);
		expect([...three.picked]).toEqual(["a", "b", "c"]);
		expect([...setPicked(three, ["b", "c", "z"], false).picked]).toEqual(["a"]);
		// Setting what is already set changes nothing.
		expect([...setPicked(three, ["a"], true).picked]).toEqual(["a", "b", "c"]);
		expect(three.all).toBeNull();
	});

	it("edits the exceptions when everything that matches is selected", () => {
		const all = pickAll(true);
		const less = setPicked(all, ["a", "b"], false);
		expect(less.all).toEqual({ andEarlier: true });
		expect([...less.except]).toEqual(["a", "b"]);
		expect(isPicked(less, "a")).toBe(false);
		expect(isPicked(less, "not loaded")).toBe(true);
		const back = setPicked(less, ["a"], true);
		expect([...back.except]).toEqual(["b"]);
		expect(back.picked.size).toBe(0);
	});

	it("doesn't change the selection it was given", () => {
		const one = setPicked(nothingPicked, ["a"], true);
		setPicked(one, ["b"], true);
		expect([...one.picked]).toEqual(["a"]);
		expect(nothingPicked.picked.size).toBe(0);
	});
});

describe("headerCheckOf", () => {
	it("is empty when the list isn't selecting or nothing is ticked", () => {
		expect(headerCheckOf(null, 5)).toBe("none");
		expect(headerCheckOf(nothingPicked, 5)).toBe("none");
	});

	it("is a dash when some are ticked, and when more rows may still load", () => {
		const two = setPicked(nothingPicked, ["a", "b"], true);
		expect(headerCheckOf(two, 5)).toBe("some");
		expect(headerCheckOf(two, undefined)).toBe("some");
	});

	it("is ticked when every Transaction that can be selected is, with all of them loaded", () => {
		const two = setPicked(nothingPicked, ["a", "b"], true);
		expect(headerCheckOf(two, 2)).toBe("all");
		expect(headerCheckOf(two, 0)).toBe("some");
	});

	it("is ticked for everything that matches, a dash once one is taken out, empty when all are", () => {
		expect(headerCheckOf(pickAll(false), undefined)).toBe("all");
		expect(headerCheckOf(pickAll(true), 3)).toBe("all");
		const less = setPicked(pickAll(false), ["a"], false);
		expect(headerCheckOf(less, 5)).toBe("some");
		expect(headerCheckOf(less, undefined)).toBe("some");
		expect(headerCheckOf(less, 1)).toBe("none");
		// Earlier months hold more than this list shows.
		expect(headerCheckOf(setPicked(pickAll(true), ["a"], false), 1)).toBe("some");
	});
});

describe("what can be selected, and whether anything is", () => {
	it("leaves Goal spending out", () => {
		expect(canPick({ goal: null })).toBe(true);
		expect(canPick({ goal: { id: "g1" } })).toBe(false);
	});

	it("knows an empty selection from one with something in it", () => {
		expect(anyPicked(nothingPicked)).toBe(false);
		expect(anyPicked(setPicked(nothingPicked, ["a"], true))).toBe(true);
		expect(anyPicked(setPicked(pickAll(false), ["a"], false))).toBe(true);
	});
});

describe("selectAllLabel", () => {
	it("says the whole thing where there is room", () => {
		expect(selectAllLabel(12, "October", { filtered: false, andEarlier: false })).toBe(
			"Select all 12 in October",
		);
		expect(selectAllLabel(1240, "October", { filtered: true, andEarlier: true })).toBe(
			"Select all 1,240 that match in October and every month before",
		);
	});

	it("is short on a phone and still says which", () => {
		expect(selectAllLabel(12, "October", { filtered: true, andEarlier: false, short: true })).toBe(
			"All 12 in October",
		);
		expect(selectAllLabel(40, "October", { filtered: false, andEarlier: true, short: true })).toBe(
			"All 40 with earlier months",
		);
	});
});
