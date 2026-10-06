import { describe, expect, it } from "vitest";
import { owedBackOnCommitmentText } from "./owed-back";

describe("a Commitment with Owed back", () => {
	it("reads how far over it is and who owes that back", () => {
		expect(owedBackOnCommitmentText(60_000, { left: 60_000, who: ["Casey"] })).toBe(
			"$600 over · $600 owed back by Casey",
		);
	});

	it("names everyone who owes, and leaves 'over' out when it isn't", () => {
		expect(owedBackOnCommitmentText(0, { left: 12_500, who: ["Casey", "Sam"] })).toBe(
			"$125 owed back by Casey and Sam",
		);
		expect(owedBackOnCommitmentText(-500, { left: 2_500, who: ["Casey"] })).toBe(
			"$25 owed back by Casey",
		);
	});

	it("says nothing once nothing is owed back", () => {
		expect(owedBackOnCommitmentText(60_000, null)).toBeNull();
		expect(owedBackOnCommitmentText(60_000, { left: 0, who: [] })).toBeNull();
	});
});
