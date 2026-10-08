import { describe, expect, it } from "vitest";
import {
	nameProblem,
	nameToCreate,
	sameName,
	suggestedAllowanceCents,
	tidyName,
} from "./new-bucket";

const names = ["Groceries", "Gas", "Dining out", "Rent"];

describe("the picker's Create row", () => {
	it("isn't offered until something is typed", () => {
		expect(nameToCreate("", names)).toBeNull();
		expect(nameToCreate("   ", names)).toBeNull();
	});

	it("offers the typed name when nothing has it", () => {
		expect(nameToCreate("Vet", names)).toBe("Vet");
	});

	it("is offered under choices that only partly match", () => {
		expect(nameToCreate("Gro", names)).toBe("Gro");
		expect(nameToCreate("Dining", names)).toBe("Dining");
	});

	it("isn't offered for a name the picker already lists, whatever its capitals or spaces", () => {
		expect(nameToCreate("gas", names)).toBeNull();
		expect(nameToCreate("  GAS ", names)).toBeNull();
		expect(nameToCreate("dining   OUT", names)).toBeNull();
		// A Commitment's name counts too: the picker lists it.
		expect(nameToCreate("rent", names)).toBeNull();
	});

	it("tidies the name it offers", () => {
		expect(nameToCreate("  Pet   food ", names)).toBe("Pet food");
		expect(tidyName("  Pet   food ")).toBe("Pet food");
	});

	it("isn't offered for a name too long for a Bucket", () => {
		expect(nameToCreate("a".repeat(40), names)).toBe("a".repeat(40));
		expect(nameToCreate("a".repeat(41), names)).toBeNull();
	});
});

describe("a new Bucket's name", () => {
	it("is needed", () => {
		expect(nameProblem("  ", names)).toBe("Give the Bucket a name.");
	});

	it("can't be one the Plan already has", () => {
		expect(sameName(" gas", "Gas")).toBe(true);
		expect(nameProblem("gas ", names)).toBe("Your Plan already has “Gas”. Pick another name.");
	});

	it("can't be longer than a Bucket's name may be", () => {
		expect(nameProblem("a".repeat(41), names)).toBe("Keep the name to 40 letters or fewer.");
	});

	it("is fine otherwise", () => {
		expect(nameProblem("Vet", names)).toBeNull();
	});
});

describe("the allowance suggested for a Bucket made from a Transaction", () => {
	it("is the amount rounded up to the next $5", () => {
		expect(suggestedAllowanceCents(1999)).toBe(2000);
		expect(suggestedAllowanceCents(450)).toBe(500);
		expect(suggestedAllowanceCents(12345)).toBe(12500);
		expect(suggestedAllowanceCents(1)).toBe(500);
	});

	it("is the amount itself when that's already a whole $5", () => {
		expect(suggestedAllowanceCents(4000)).toBe(4000);
	});

	it("goes by the size of a refund", () => {
		expect(suggestedAllowanceCents(-1999)).toBe(2000);
	});

	it("is nothing when there's no amount", () => {
		expect(suggestedAllowanceCents(0)).toBeNull();
	});
});
