import { describe, expect, it } from "vitest";
import { opensBucketSheet } from "./bucket-row-click";

/** Stands in for an element: `inside` is the nearest control around it, if any. */
const element = (inside: string | null) =>
	({ closest: () => (inside === null ? null : { tagName: inside }) }) as unknown as Element;

const rowWith = (...children: Element[]) =>
	({ contains: (node: Node | null) => children.includes(node as Element) }) as Pick<
		Node,
		"contains"
	>;

describe("opensBucketSheet", () => {
	it("opens for the amount, the figures or the space between them", () => {
		const amount = element(null);
		expect(opensBucketSheet(amount, rowWith(amount))).toBe(true);
	});

	it("leaves the name's link, the handle and the pencil to do their own thing", () => {
		const link = element("A");
		const handle = element("BUTTON");
		expect(opensBucketSheet(link, rowWith(link, handle))).toBe(false);
		expect(opensBucketSheet(handle, rowWith(link, handle))).toBe(false);
	});

	it("ignores what happens in the sheet, which isn't inside the row on the page", () => {
		const inSheet = element(null);
		expect(opensBucketSheet(inSheet, rowWith())).toBe(false);
	});

	it("ignores an event with no element", () => {
		expect(opensBucketSheet(null, rowWith())).toBe(false);
		expect(opensBucketSheet({} as EventTarget, rowWith())).toBe(false);
	});
});
