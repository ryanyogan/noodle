import { STUCK_AFTER_MS } from "@noodle/db";
import { describe, expect, it } from "vitest";
import { troubleOf } from "./fresh-start-trouble";

// What a failed or stuck fresh start says has been done (issue 118): never more than was.

const NOW = Date.parse("2026-10-05T21:00:00Z");
const row = (over: Partial<Parameters<typeof troubleOf>[0]> = {}) => ({
	level: "fresh-start" as const,
	status: "failed" as const,
	runAt: new Date(NOW),
	progressAt: new Date(NOW + 1000),
	step: 3,
	label: "Forgetting merchants",
	failedStep: "merchants",
	failedAt: new Date(NOW + 2000),
	...over,
});

describe("a fresh start in trouble", () => {
	it("is none while it runs and moves, waits, or is over", () => {
		expect(troubleOf(row({ status: "running", failedStep: null }), NOW + 60_000)).toBeNull();
		expect(troubleOf(row({ status: "scheduled", runAt: new Date(NOW + 1) }), NOW)).toBeNull();
		expect(troubleOf(row({ status: "done" }), NOW + 10 * STUCK_AFTER_MS)).toBeNull();
	});

	it("that failed forgetting merchants has a snapshot, banks and background work done", () => {
		expect(troubleOf(row(), NOW + 5000)).toEqual({
			kind: "failed",
			stoppedAt: "Forgetting merchants",
			since: NOW + 2000,
			notBegun: false,
			done: ["a snapshot taken", "banks disconnected", "background work stopped"],
		});
	});

	it("that failed taking the snapshot has done nothing", () => {
		const trouble = troubleOf(row({ step: 0, label: null, failedStep: "snapshot" }), NOW + 5000);
		expect(trouble).toMatchObject({ stoppedAt: "Taking a snapshot", done: [] });
	});

	it("that failed at the first step has only the snapshot", () => {
		const trouble = troubleOf(row({ step: 1, failedStep: "banks" }), NOW + 5000);
		expect(trouble).toMatchObject({ stoppedAt: "Disconnecting banks", done: ["a snapshot taken"] });
	});

	it("never counts the failed step, or those after it, as done", () => {
		// A later run went over an earlier step again and that one failed.
		const trouble = troubleOf(row({ step: 5, failedStep: "background" }), NOW + 5000);
		expect(trouble?.done).toEqual(["a snapshot taken", "banks disconnected"]);
		const last = troubleOf(row({ step: 5, failedStep: "rows" }), NOW + 5000);
		expect(last?.done).not.toContain("Transactions and the Plan cleared");
		expect(last?.done.at(-1)).toBe("statements and receipts cleared");
	});

	it("deleting the Household says nothing of a snapshot", () => {
		expect(troubleOf(row({ level: "delete" }), NOW + 5000)?.done).toEqual([
			"banks disconnected",
			"background work stopped",
		]);
	});

	it("that stopped moving says where and since when", () => {
		const stuck = row({ status: "running", failedStep: null, failedAt: null });
		expect(troubleOf(stuck, NOW + 1000 + STUCK_AFTER_MS + 1)).toEqual({
			kind: "stuck",
			stoppedAt: "Forgetting merchants",
			since: NOW + 1000,
			notBegun: false,
			done: ["a snapshot taken", "banks disconnected", "background work stopped"],
		});
	});

	it("that was due and never began has done nothing", () => {
		const due = row({
			status: "scheduled",
			step: 0,
			label: null,
			failedStep: null,
			failedAt: null,
			progressAt: null,
		});
		expect(troubleOf(due, NOW + STUCK_AFTER_MS + 1)).toEqual({
			kind: "stuck",
			stoppedAt: null,
			since: NOW,
			notBegun: true,
			done: [],
		});
	});
});
