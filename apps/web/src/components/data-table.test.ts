import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import {
	ariaSort,
	columnTiers,
	gridTemplate,
	headerCheck,
	nextSort,
	rangeIds,
	selectsAll,
	stackedLayout,
	stackedTemplate,
	TABLE_TIERS,
} from "@noodle/ui/lib/data-table";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The Buckets table's columns as issue 107's design lists them (the Order handle is the leading slot).
const buckets = [
	{ id: "bucket", min: 10, width: "minmax(0,2fr)", priority: 1, stacked: "title" },
	{ id: "allowance", min: 6.5, width: "6.5rem", priority: 1, stacked: "value" },
	{ id: "spent", min: 6, width: "6rem", priority: 2, stacked: "hidden" },
	{ id: "left", min: 6, width: "6rem", priority: 2, stacked: "hidden" },
	{ id: "pace", min: 6, width: "minmax(6rem,1fr)", priority: 3, stacked: "hidden" },
	{ id: "end", min: 7, width: "7rem", priority: 4, stacked: "secondary" },
	{ id: "edit", min: 2.25, width: "2.25rem", priority: 1, stacked: "trailing" },
] as const;

describe("which columns show", () => {
	it("keeps priority 1 from the first tier and adds the rest as the container widens", () => {
		// 2.5 of padding and a 2.75 handle with its gap.
		const tiers = columnTiers(buckets, { reserved: 2.5 + 2.75 + 0.75 });
		expect(tiers).toEqual({ bucket: 0, allowance: 0, edit: 0, spent: 0, left: 0, pace: 1, end: 2 });
	});

	it("drops strictly by priority: nothing shows while something that matters more is out", () => {
		const tiers = columnTiers([
			{ id: "name", min: 20 },
			{ id: "wide", min: 30, priority: 2 },
			{ id: "small", min: 2, priority: 3 },
		]);
		// `small` would fit at 42rem beside `name`, but `wide` matters more and does not.
		expect(tiers).toEqual({ name: 0, wide: 2, small: 2 });
	});

	it("shows everything at the widest tier, and a wider tier never shows less", () => {
		const tiers = columnTiers([
			{ id: "a", min: 40 },
			{ id: "b", min: 40, priority: 2 },
			{ id: "c", min: 40, priority: 3 },
		]);
		expect(tiers).toEqual({ a: 0, b: TABLE_TIERS.length - 1, c: TABLE_TIERS.length - 1 });
	});

	it("drops columns of the same priority from the right, and leaves stacked-only ones out", () => {
		const tiers = columnTiers([
			{ id: "a", min: 20 },
			{ id: "b", min: 20, priority: 2 },
			{ id: "c", min: 20, priority: 2 },
			{ id: "line", min: 0, wide: false },
		]);
		expect(tiers).toEqual({ a: 0, b: 0, c: 3 });
	});

	it("writes a template of the columns showing, in the page's order", () => {
		const tiers = columnTiers(buckets, { reserved: 6 });
		expect(gridTemplate(buckets, tiers, 0, ["2.75rem"])).toBe(
			"2.75rem minmax(0,2fr) 6.5rem 6rem 6rem 2.25rem",
		);
		expect(gridTemplate(buckets, tiers, 4, ["2.75rem"])).toBe(
			"2.75rem minmax(0,2fr) 6.5rem 6rem 6rem minmax(6rem,1fr) 7rem 2.25rem",
		);
		expect(gridTemplate([{ id: "a", min: 8 }], { a: 0 }, 0)).toBe("minmax(8rem,1fr)");
	});
});

describe("a stacked row", () => {
	it("puts a title and a value on the first line and each secondary column under them", () => {
		const { places, rows, has } = stackedLayout(buckets);
		expect(places.bucket).toEqual({ slot: "title", row: 1 });
		expect(places.allowance).toEqual({ slot: "value", row: 1 });
		expect(places.spent?.slot).toBe("hidden");
		expect(places.end).toEqual({ slot: "secondary", row: 2 });
		expect(places.edit?.slot).toBe("trailing");
		expect(rows).toBe(2);
		expect(has).toEqual({ value: true, trailing: true });
	});

	it("takes the first column as the title when none is named", () => {
		const { places, rows } = stackedLayout([
			{ id: "name", min: 8 },
			{ id: "who", min: 4 },
			{ id: "from", min: 4 },
		]);
		expect(places).toEqual({
			name: { slot: "title", row: 1 },
			who: { slot: "secondary", row: 2 },
			from: { slot: "secondary", row: 3 },
		});
		expect(rows).toBe(3);
	});

	it("never puts two columns in one place", () => {
		const { places } = stackedLayout([
			{ id: "a", min: 1, stacked: "title" },
			{ id: "b", min: 1, stacked: "title" },
			{ id: "c", min: 1, stacked: "value" },
			{ id: "d", min: 1, stacked: "value" },
			{ id: "e", min: 1, stacked: "trailing" },
			{ id: "f", min: 1, stacked: "trailing" },
		]);
		expect(places.b).toEqual({ slot: "secondary", row: 2 });
		expect(places.d).toEqual({ slot: "secondary", row: 3 });
		expect(places.f?.slot).toBe("hidden");
	});

	it("has a track only for what is there", () => {
		expect(stackedTemplate({ select: false, leading: null, value: false, trailing: false })).toBe(
			"[main] minmax(0,1fr) [mainend]",
		);
		expect(stackedTemplate({ select: true, leading: "2.75rem", value: true, trailing: true })).toBe(
			"[sel] 2.75rem [lead] 2.75rem [main] minmax(0,1fr) [val] auto [mainend trail] auto",
		);
	});
});

describe("selecting", () => {
	const ordered = ["a", "b", "c", "d", "e"];

	it("takes the rows from the one ticked last to this one, either way round", () => {
		expect(rangeIds(ordered, "b", "d")).toEqual(["b", "c", "d"]);
		expect(rangeIds(ordered, "d", "b")).toEqual(["b", "c", "d"]);
		expect(rangeIds(ordered, "c", "c")).toEqual(["c"]);
	});

	it("is just this row with no anchor, or one that has left the list", () => {
		expect(rangeIds(ordered, null, "c")).toEqual(["c"]);
		expect(rangeIds(ordered, "gone", "c")).toEqual(["c"]);
		expect(rangeIds(ordered, "a", "gone")).toEqual([]);
	});

	it("says all, some or none in the header from the page's counts", () => {
		expect(headerCheck(0, 400)).toBe("none");
		expect(headerCheck(3, 400)).toBe("some");
		expect(headerCheck(400, 400)).toBe("all");
		// All that match, less two tapped off again.
		expect(headerCheck(400 - 2, 400)).toBe("some");
		expect(headerCheck(0, 0)).toBe("none");
	});

	it("selects everything from none or some, and nothing from all", () => {
		expect([selectsAll("none"), selectsAll("some"), selectsAll("all")]).toEqual([
			true,
			true,
			false,
		]);
	});
});

describe("sorting", () => {
	it("starts a column its own first way, then flips, with no unsorted step", () => {
		const date = { id: "date", desc: true };
		expect(nextSort(null, "name")).toEqual({ id: "name", desc: false });
		expect(nextSort(date, "name")).toEqual({ id: "name", desc: false });
		expect(nextSort(date, "amount", true)).toEqual({ id: "amount", desc: true });
		expect(nextSort(date, "date", true)).toEqual({ id: "date", desc: false });
		expect(nextSort({ id: "date", desc: false }, "date", true)).toEqual(date);
	});

	it("says which way only on the column in use", () => {
		expect(ariaSort({ id: "date", desc: true }, "date")).toBe("descending");
		expect(ariaSort({ id: "date", desc: false }, "date")).toBe("ascending");
		expect(ariaSort({ id: "date", desc: true }, "name")).toBeUndefined();
		expect(ariaSort(null, "name")).toBeUndefined();
	});
});

type Line = { id: string; name: string; cents: number };
const lines: Line[] = [
	{ id: "t1", name: "Costco", cents: 8412 },
	{ id: "t2", name: "Shell", cents: 4100 },
	{ id: "t3", name: "Rent", cents: 180000 },
];
const columns: DataTableColumn<Line>[] = [
	{
		id: "name",
		header: "Name",
		min: 10,
		sortable: { said: { asc: "A to Z", desc: "Z to A" } },
		cell: (line) => line.name,
		footer: "Total",
	},
	{ id: "note", header: "Note", min: 30, priority: 3, cell: () => "", stacked: "hidden" },
	{
		id: "amount",
		header: "Amount",
		min: 6,
		width: "6rem",
		align: "end",
		stacked: "value",
		sortable: { descFirst: true },
		cell: (line) => `$${line.cents / 100}`,
		footer: "$1,925.12",
	},
	{ id: "gone", header: "Gone", min: 4, hidden: true, cell: () => "never" },
];

/** Every opening tag with this role. */
const tags = (html: string, role: string) =>
	html.match(new RegExp(`<[a-z]+ [^>]*role="${role}"[^>]*>`, "g")) ?? [];

describe("DataTable", () => {
	const html = renderToStaticMarkup(
		h(DataTable<Line>, {
			label: "Transactions in October",
			columns,
			data: lines,
			getRowId: (line) => line.id,
			sort: { id: "amount", desc: true },
			onSortChange: () => {},
			onOpen: () => {},
			isOpen: (line) => line.id === "t2",
			rowCount: 400,
			selection: {
				isSelected: (line) => line.id === "t1",
				canSelect: (line) => line.id !== "t3",
				rowLabel: (line) => `Select ${line.name}`,
				all: "some",
				onSelect: () => {},
				onSelectAll: () => {},
			},
			leading: { header: "Order", render: (line) => `grip ${line.id}` },
		}),
	);

	it("is a grid of row groups, rows and cells on divs, never a table element", () => {
		expect(html).not.toMatch(/<(table|tr|td|th|thead|tbody)[\s>]/);
		const root = tags(html, "grid")[0] ?? "";
		expect(root).toContain('aria-label="Transactions in October"');
		expect(root).toContain('aria-multiselectable="true"');
		expect(root).toContain('aria-rowcount="400"');
		expect(root).toContain("@container/dt");
		expect(tags(html, "rowgroup")).toHaveLength(3);
		// The header, three rows and the totals.
		expect(tags(html, "row")).toHaveLength(5);
		// A checkbox, the leading slot and three columns to a row; the hidden column is nowhere.
		expect(tags(html, "gridcell")).toHaveLength(5 * 3 + 5);
		expect(html).not.toContain("never");
	});

	it("names its columns, and only the one sorting the list says which way", () => {
		const heads = tags(html, "columnheader");
		expect(heads).toHaveLength(5);
		expect(heads.filter((head) => head.includes("aria-sort"))).toHaveLength(1);
		expect(heads.find((head) => head.includes('data-column="amount"'))).toContain(
			'aria-sort="descending"',
		);
		expect(html).toContain('aria-label="Amount, descending"');
		expect(html).toContain('aria-label="Sort by name"');
		expect(html).toContain("Order");
	});

	it("keeps the rows in the order given, marks the selected and the open one, and one tab stop", () => {
		const rows = tags(html, "row").filter((row) => row.includes("data-dt-row"));
		expect(rows.map((row) => row.match(/data-row-id="([^"]+)"/)?.[1])).toEqual(["t1", "t2", "t3"]);
		expect(rows.map((row) => row.includes('aria-selected="true"'))).toEqual([true, false, false]);
		expect(rows.map((row) => row.includes('aria-current="true"'))).toEqual([false, true, false]);
		// The open row is the one in the tab order.
		expect(rows.map((row) => row.match(/tabindex="(-?\d)"/)?.[1])).toEqual(["-1", "0", "-1"]);
	});

	it("has a checkbox a row, mixed in the header, and off for a row that can't be selected", () => {
		const boxes = tags(html, "checkbox");
		expect(boxes).toHaveLength(4);
		expect(boxes[0]).toContain('aria-checked="mixed"');
		expect(boxes[0]).toContain('aria-label="Select all"');
		expect(boxes[1]).toContain('aria-checked="true"');
		expect(boxes[1]).toContain('aria-label="Select Costco"');
		expect(boxes[3]).toContain('aria-label="Select Rent"');
	});

	it("lays rows out from the column list: stacked first, then by tier, money on the right", () => {
		const root = tags(html, "grid")[0] ?? "";
		expect(root).toContain(
			"--dt-stack:[sel] 2.75rem [lead] 2.75rem [main] minmax(0,1fr) [val] auto [mainend]",
		);
		expect(root).toContain("--dt-cols-0:2rem 2.75rem minmax(10rem,1fr) 6rem");
		expect(root).toContain("--dt-cols-4:2rem 2.75rem minmax(10rem,1fr) minmax(30rem,1fr) 6rem");
		const amount =
			html.match(/<div [^>]*role="gridcell"[^>]*data-column="amount"[^>]*>/)?.[0] ?? "";
		expect(amount).toContain("tabular-nums");
		expect(amount).toContain("[grid-column:val]");
		expect(amount).toContain("@2xl/dt:justify-end");
		const note = html.match(/<div [^>]*role="gridcell"[^>]*data-column="note"[^>]*>/)?.[0] ?? "";
		expect(note).toMatch(/class="[^"]*\bhidden\b/);
	});

	it("is a plain table when rows neither open nor select, and says so when empty or loading", () => {
		const plain = renderToStaticMarkup(
			h(DataTable<Line>, {
				label: "Buckets",
				columns,
				data: [],
				getRowId: (line) => line.id,
				empty: "No Buckets yet",
			}),
		);
		expect(tags(plain, "table")).toHaveLength(1);
		expect(tags(plain, "cell")).toHaveLength(1);
		expect(plain).toContain("No Buckets yet");
		expect(plain).not.toContain("aria-selected");
		expect(plain).not.toContain("tabindex");

		const loading = renderToStaticMarkup(
			h(DataTable<Line>, {
				label: "Buckets",
				columns,
				data: lines,
				getRowId: (line) => line.id,
				loading: true,
			}),
		);
		expect(tags(loading, "table")[0]).toContain('aria-busy="true"');
		expect(loading).not.toContain("data-dt-row");
	});
});

describe("a cell's place in the tree", () => {
	// There is no DOM in these tests to hold a cell's node and compare it after a second render, so
	// this checks what keeps the node. A cell is drawn by the table itself while it draws the row,
	// not as a component made from the column's `cell` function: such a component is a new one
	// whenever the page hands over a new columns array, and React then throws away every cell's
	// nodes, and the focus in them, on each render. Drawn as components, every row's props would
	// be asked for first and the cells only afterwards.
	it("draws a row's cells while it draws the row, whatever columns array it is given", () => {
		const drawn: string[] = [];
		const make = (): DataTableColumn<Line>[] => [
			{
				id: "name",
				header: "Name",
				min: 10,
				footer: "Total",
				cell: (line) => {
					drawn.push(`cell ${line.id}`);
					return line.name;
				},
			},
		];
		const render = () =>
			renderToStaticMarkup(
				h(DataTable<Line>, {
					label: "Buckets",
					columns: make(),
					data: lines,
					getRowId: (line) => line.id,
					rowProps: (line) => {
						drawn.push(`row ${line.id}`);
						return {};
					},
				}),
			);
		const first = render();
		const order = lines.flatMap((line) => [`row ${line.id}`, `cell ${line.id}`]);
		expect(drawn).toEqual(order);
		// A new but equal columns array draws the same thing the same way.
		expect(render()).toBe(first);
		expect(drawn).toEqual([...order, ...order]);
		expect(first).toContain("Total");
	});
});
