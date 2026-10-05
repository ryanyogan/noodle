import { toastDuration, UNDO_TOAST_MS } from "@noodle/ui/components/toast";
import { describe, expect, it } from "vitest";

// How long a toast stays (#78): by kind unless a time is asked for, and a sticky one always
// until it's dismissed.
describe("how long a toast stays", () => {
	const action = { label: "View", onClick: () => {} };
	const undo = () => {};

	it("stays ten seconds with Undo, whatever else is asked (#103)", () => {
		expect(UNDO_TOAST_MS).toBe(10_000);
		expect(toastDuration({ tone: "success", undo })).toBe(UNDO_TOAST_MS);
		expect(toastDuration({ tone: "success", undo, sticky: true })).toBe(UNDO_TOAST_MS);
		expect(toastDuration({ tone: "success", undo, duration: 6_000 })).toBe(UNDO_TOAST_MS);
		expect(toastDuration({ tone: "error", undo, action })).toBe(UNDO_TOAST_MS);
	});

	it("goes by kind when no time is asked for", () => {
		expect(toastDuration({ tone: "success" })).toBe(2_400);
		expect(toastDuration({ tone: "success", action })).toBe(6_000);
		expect(toastDuration({ tone: "error" })).toBe(10_000);
		expect(toastDuration({ tone: "error", action })).toBe(10_000);
		expect(toastDuration({ tone: "success", sticky: true })).toBe(Number.POSITIVE_INFINITY);
	});

	it("stays for the time asked for, whatever its kind", () => {
		expect(toastDuration({ tone: "success", duration: 10_000 })).toBe(10_000);
		expect(toastDuration({ tone: "success", action, duration: 12_000 })).toBe(12_000);
		expect(toastDuration({ tone: "error", duration: 4_000 })).toBe(4_000);
	});

	it("stays until dismissed when sticky, even with a time", () => {
		expect(toastDuration({ tone: "success", sticky: true, duration: 10_000 })).toBe(
			Number.POSITIVE_INFINITY,
		);
	});

	it("goes by kind when the time asked for isn't a length of time", () => {
		expect(toastDuration({ tone: "success", duration: 0 })).toBe(2_400);
		expect(toastDuration({ tone: "success", duration: -5 })).toBe(2_400);
		expect(toastDuration({ tone: "success", duration: Number.NaN })).toBe(2_400);
		expect(toastDuration({ tone: "error", duration: Number.POSITIVE_INFINITY })).toBe(10_000);
	});
});
