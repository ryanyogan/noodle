import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// An edit of a money-in line (whose pay, note, amount, date) left waiting by an earlier page is
// sent again like a Transaction's (issue 133, ADR-0041, ADR-0056): by the function its screen
// uses, on the version written down for it. The server function is the only thing stood in for.

const server = vi.hoisted(() => ({ editMoneyInLine: vi.fn() }));
vi.mock("./server/money-in", () => server);
vi.mock("@noodle/ui/components/toast", () => ({ toast: vi.fn() }));

import type { MoneyInEditChange, MoneyInLine } from "./money-in";
import type { Waiting } from "./outbox";
import {
	ChangedElsewhere,
	carryVersions,
	expectedVersionOf,
	forgetVersions,
	noteVersion,
} from "./transaction-versions";
import { resendWith } from "./waiting-writes";

const line = {
	id: "income-1",
	amount: 250000,
	date: "2026-10-02",
	note: "ACME PAYROLL",
	kind: "income",
	needsReview: false,
	version: 2,
	accountId: "checking",
	typed: false,
	transferId: null,
	paired: false,
	otherAccountId: null,
	whosePay: null,
} as unknown as MoneyInLine;

const change: MoneyInEditChange = { line, edit: { whosePay: "sam" }, month: "2026-10" };

/** What the outbox wrote down for the edit, read by a later page: nothing is remembered there. */
function leftWaiting(): { waiting: Waiting; variables: unknown } {
	const variables = JSON.parse(JSON.stringify(carryVersions("money-in-edit", change)));
	forgetVersions();
	return {
		waiting: { kind: "money-in-edit", variables, tries: 0 } as unknown as Waiting,
		variables,
	};
}

beforeEach(() => {
	forgetVersions();
	server.editMoneyInLine.mockReset();
});

describe("an edit of a money-in line left waiting when the page was left", () => {
	it("is sent again on the version this screen's own earlier answer gave", async () => {
		// The screen changed the line's kind first, which answered version 4.
		noteVersion(line.id, 4);
		const { waiting, variables } = leftWaiting();
		server.editMoneyInLine.mockResolvedValue({
			ok: true,
			line: { ...line, version: 5, whosePay: "sam" },
			months: ["2026-10"],
		});
		const resend = resendWith(new QueryClient())(waiting);
		expect(resend).not.toBeNull();
		await resend?.mutationFn?.(variables as never, {} as never);
		expect(server.editMoneyInLine).toHaveBeenCalledWith({
			data: { incomeId: "income-1", expectedVersion: 4, edit: { whosePay: "sam" } },
		});
		// The next change to it goes on the version this one answered.
		expect(expectedVersionOf(line)).toBe(5);
	});

	it("is refused, never written over, when the line changed on another screen since", async () => {
		const { waiting, variables } = leftWaiting();
		server.editMoneyInLine.mockResolvedValue({
			ok: false,
			reason: "changed-elsewhere",
			current: { ...line, version: 7 },
		});
		const resend = resendWith(new QueryClient())(waiting);
		await expect(resend?.mutationFn?.(variables as never, {} as never)).rejects.toBeInstanceOf(
			ChangedElsewhere,
		);
		expect(server.editMoneyInLine).toHaveBeenCalledWith({
			data: { incomeId: "income-1", expectedVersion: 2, edit: { whosePay: "sam" } },
		});
	});
});
