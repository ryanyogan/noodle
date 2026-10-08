import { describe, expect, it } from "vitest";
import { betweenUsMeans, lowerFirst } from "./review-between-us";

describe("what Between us means, beside Transfer", () => {
	it("names the two Parents, either way round", () => {
		expect(betweenUsMeans(["Alex", "Sam"])).toBe("Money Alex sent Sam, or Sam sent Alex");
	});

	it("needs no names with one Parent, or before the names are loaded", () => {
		expect(betweenUsMeans(["Alex"])).toBe("Money one of you sent the other");
		expect(betweenUsMeans([])).toBe("Money one of you sent the other");
	});

	it("reads on after a colon", () => {
		expect(lowerFirst(betweenUsMeans(["Alex", "Sam"]))).toBe(
			"money Alex sent Sam, or Sam sent Alex",
		);
	});
});
