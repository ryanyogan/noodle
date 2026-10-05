import { describe, expect, it } from "vitest";
import { escapeStep } from "./transaction-table";

// Esc on the Transactions page steps back one thing at a time (issue 99).
describe("escapeStep", () => {
	const nothing = { overlay: false, typing: false, open: false, selecting: false };

	it("leaves Esc to a menu, a picker or a sheet that is open", () => {
		expect(escapeStep({ ...nothing, overlay: true, open: true, selecting: true })).toBe("nothing");
	});

	it("closes the open Transaction before it ends the selection", () => {
		expect(escapeStep({ ...nothing, open: true, selecting: true })).toBe("close");
		expect(escapeStep({ ...nothing, open: true, typing: true })).toBe("close");
	});

	it("ends the selection when nothing else is open", () => {
		expect(escapeStep({ ...nothing, selecting: true })).toBe("unselect");
	});

	it("doesn't end the selection from a field being typed in, and does nothing with nothing to step back from", () => {
		expect(escapeStep({ ...nothing, selecting: true, typing: true })).toBe("nothing");
		expect(escapeStep(nothing)).toBe("nothing");
	});
});
