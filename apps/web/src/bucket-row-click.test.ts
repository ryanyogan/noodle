import { describe, expect, it } from "vitest";
import { beginsOnHandle, bucketClick } from "./bucket-row-click";

/** Stands in for an element: `inside` lists what it is, or sits within. */
const element = (...inside: ("row" | "handle" | "pencil" | "amount" | "link" | "button")[]) =>
	({
		closest: (selector: string) => {
			const hit =
				(selector.includes("[data-bucket-row]") && inside.includes("row")) ||
				(selector.includes("[data-reorder]") && inside.includes("handle")) ||
				(selector.includes("[data-bucket-edit]") && inside.includes("pencil")) ||
				(selector.includes("[data-bucket-amount]") && inside.includes("amount")) ||
				(/(^|, )button/.test(selector) &&
					inside.some((kind) => ["handle", "pencil", "amount", "button"].includes(kind)));
			return hit ? {} : null;
		},
	}) as unknown as Element;

const listWith = (...children: Element[]) =>
	({ contains: (node: Node | null) => children.includes(node as Element) }) as Pick<
		Node,
		"contains"
	>;

describe("bucketClick", () => {
	it("opens the Bucket's panel for its row: a figure, the space between, or its name", () => {
		const figure = element("row");
		const name = element("row", "link");
		expect(bucketClick(figure, listWith(figure), false)).toBe("panel");
		expect(bucketClick(name, listWith(name), false)).toBe("panel");
	});

	it("opens the sheet for the pencil and for the allowance", () => {
		const pencil = element("row", "pencil");
		const amount = element("row", "amount");
		expect(bucketClick(pencil, listWith(pencil), false)).toBe("sheet");
		expect(bucketClick(amount, listWith(amount), false)).toBe("sheet");
	});

	it("opens nothing for the handle, or for the click that ends a drag wherever it lands", () => {
		const handle = element("row", "handle");
		const figure = element("row");
		expect(bucketClick(handle, listWith(handle), false)).toBe("nothing");
		expect(bucketClick(handle, listWith(handle), true)).toBe("nothing");
		expect(bucketClick(figure, listWith(figure), true)).toBe("nothing");
	});

	it("opens nothing for another control, or outside any row", () => {
		const retry = element("button");
		const totals = element();
		expect(bucketClick(retry, listWith(retry), false)).toBe("nothing");
		expect(bucketClick(totals, listWith(totals), false)).toBe("nothing");
	});

	it("ignores what happens in the sheet, which isn't inside the list on the page", () => {
		const inSheet = element("row");
		expect(bucketClick(inSheet, listWith(), false)).toBe("nothing");
	});

	it("ignores an event with no element", () => {
		expect(bucketClick(null, listWith(), false)).toBe("nothing");
		expect(bucketClick({} as EventTarget, listWith(), false)).toBe("nothing");
	});
});

describe("beginsOnHandle", () => {
	it("is true only for a press on the handle", () => {
		expect(beginsOnHandle(element("row", "handle"))).toBe(true);
		expect(beginsOnHandle(element("row", "pencil"))).toBe(false);
		expect(beginsOnHandle(element("row"))).toBe(false);
		expect(beginsOnHandle(null)).toBe(false);
	});
});
