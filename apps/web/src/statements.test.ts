import { describe, expect, test } from "vitest";
import { importSummary } from "./statements";

const summary = (transactionCount: number, incomeCount: number, duplicateCount: number) =>
	importSummary({ transactionCount, incomeCount, duplicateCount });

describe("importSummary", () => {
	test("says what came in, and what was already there", () => {
		expect(summary(5, 1, 0)).toBe("5 Transactions and 1 deposit as income");
		expect(summary(1, 0, 3)).toBe("1 Transaction; 3 already imported");
		expect(summary(0, 2, 0)).toBe("2 deposits as income");
	});

	test("says how many were Matched to Quick Adds", () => {
		const record = { transactionCount: 3, incomeCount: 0, duplicateCount: 0 };
		expect(importSummary({ ...record, matchedCount: 1 })).toBe(
			"3 Transactions; 1 Matched to a Quick Add",
		);
		expect(importSummary({ ...record, matchedCount: 2, duplicateCount: 1 })).toBe(
			"3 Transactions; 2 Matched to Quick Adds; 1 already imported",
		);
	});

	test("says when nothing was new", () => {
		expect(summary(0, 0, 6)).toBe("Nothing new; 6 already imported");
		expect(summary(0, 0, 0)).toBe("Nothing new");
	});
});
