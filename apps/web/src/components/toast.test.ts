import { toastDuration, UNDO_TOAST_MS, undoOrGone } from "@noodle/ui/components/toast";
import { describe, expect, it, vi } from "vitest";

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

// A change sent only once its Undo has gone (#97): the toast leaving and Undo never both happen.
describe("an Undo, or the toast going without it", () => {
	it("says the toast has gone once, however often Sonner reports it", () => {
		const undo = vi.fn();
		const onGone = vi.fn();
		const latch = undoOrGone(undo, onGone);
		latch.gone();
		latch.gone();
		expect(onGone).toHaveBeenCalledTimes(1);
		// Pressed while the toast is on its way out: too late, the change has been sent.
		latch.undo();
		expect(undo).not.toHaveBeenCalled();
	});

	it("never says it has gone after Undo, which closes the toast itself", () => {
		const undo = vi.fn();
		const onGone = vi.fn();
		const latch = undoOrGone(undo, onGone);
		latch.undo();
		latch.undo();
		latch.gone();
		expect(undo).toHaveBeenCalledTimes(1);
		expect(onGone).not.toHaveBeenCalled();
	});

	it("needs nothing to follow: an Undo alone still runs once", () => {
		const undo = vi.fn();
		const latch = undoOrGone(undo);
		latch.gone();
		latch.undo();
		expect(undo).not.toHaveBeenCalled();
	});
});
