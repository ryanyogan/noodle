import { describe, expect, it } from "vitest";
import {
	clampDrag,
	dragBegins,
	edgeScroll,
	indexAt,
	MOUSE_SLOP,
	moved,
	type RowBox,
	shifts,
} from "./bucket-drag";

/** Four rows 60 px tall, one after the other from 100 px down. */
const rows: RowBox[] = [0, 1, 2, 3].map((index) => ({ top: 100 + index * 60, height: 60 }));

describe("dragBegins", () => {
	it("lifts the row at once under a finger or a pen", () => {
		expect(dragBegins("touch", 0, 0)).toBe(true);
		expect(dragBegins("pen", 0, 0)).toBe(true);
	});

	it("waits for a mouse to travel a few px, in any direction", () => {
		expect(dragBegins("mouse", 0, 0)).toBe(false);
		expect(dragBegins("mouse", 2, 2)).toBe(false);
		expect(dragBegins("mouse", 0, MOUSE_SLOP)).toBe(true);
		expect(dragBegins("mouse", 0, -MOUSE_SLOP)).toBe(true);
		expect(dragBegins("mouse", MOUSE_SLOP, 0)).toBe(true);
		expect(dragBegins("mouse", 3, 3)).toBe(true);
	});
});

describe("indexAt", () => {
	it("stays put until half a row has been travelled", () => {
		expect(indexAt(rows, 1, 0)).toBe(1);
		expect(indexAt(rows, 1, 30)).toBe(1);
		expect(indexAt(rows, 1, -30)).toBe(1);
	});

	it("moves one place once half a row has been passed, down or up", () => {
		expect(indexAt(rows, 1, 31)).toBe(2);
		expect(indexAt(rows, 1, -31)).toBe(0);
	});

	it("goes down as readily as up, to either end", () => {
		expect(indexAt(rows, 0, 180)).toBe(3);
		expect(indexAt(rows, 3, -180)).toBe(0);
		expect(indexAt(rows, 0, 91)).toBe(2);
		expect(indexAt(rows, 3, -91)).toBe(1);
	});

	it("measures rows of different heights by their own middles", () => {
		const uneven: RowBox[] = [
			{ top: 0, height: 40 },
			{ top: 40, height: 100 },
			{ top: 140, height: 40 },
		];
		// The short first row's bottom edge has to reach the tall row's middle, 90 px down.
		expect(indexAt(uneven, 0, 49)).toBe(0);
		expect(indexAt(uneven, 0, 51)).toBe(1);
		expect(indexAt(uneven, 2, -49)).toBe(2);
		expect(indexAt(uneven, 2, -51)).toBe(1);
	});

	it("answers the same place for a row that isn't there", () => {
		expect(indexAt(rows, 9, 50)).toBe(9);
		expect(indexAt([], 0, 50)).toBe(0);
	});
});

describe("shifts", () => {
	it("carries the dragged row and leaves the rest alone while it hasn't passed any", () => {
		expect(shifts(rows, 1, 1, 12)).toEqual([0, 12, 0, 0]);
	});

	it("moves the rows passed on the way down up by one row", () => {
		expect(shifts(rows, 0, 2, 100)).toEqual([100, -60, -60, 0]);
	});

	it("moves the rows passed on the way up down by one row", () => {
		expect(shifts(rows, 3, 1, -100)).toEqual([0, 60, 60, -100]);
	});

	it("counts the space between rows", () => {
		const spaced: RowBox[] = [0, 1, 2].map((index) => ({ top: index * 70, height: 60 }));
		expect(shifts(spaced, 0, 1, 40)).toEqual([40, -70, 0]);
	});
});

describe("clampDrag", () => {
	it("keeps the dragged row inside the list", () => {
		expect(clampDrag(rows, 1, -500)).toBe(-60);
		expect(clampDrag(rows, 1, 500)).toBe(120);
		expect(clampDrag(rows, 1, 25)).toBe(25);
		expect(clampDrag(rows, 0, -1)).toBe(0);
		expect(clampDrag(rows, 3, 1)).toBe(0);
	});

	it("is nothing for a row that isn't there", () => {
		expect(clampDrag([], 0, 40)).toBe(0);
	});
});

describe("edgeScroll", () => {
	it("is still in the middle of the screen", () => {
		expect(edgeScroll(400, 0, 800)).toBe(0);
	});

	it("scrolls up near the top and down near the bottom, faster nearer the edge", () => {
		expect(edgeScroll(28, 0, 800)).toBe(-7);
		expect(edgeScroll(0, 0, 800)).toBe(-14);
		expect(edgeScroll(-50, 0, 800)).toBe(-14);
		expect(edgeScroll(772, 0, 800)).toBe(7);
		expect(edgeScroll(900, 0, 800)).toBe(14);
	});

	it("does nothing where there's too little room to tell an edge from the middle", () => {
		expect(edgeScroll(10, 0, 120)).toBe(0);
	});
});

describe("moved", () => {
	it("puts the Bucket at its new place and keeps the others in order", () => {
		expect(moved(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
		expect(moved(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
		expect(moved(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
	});
});
