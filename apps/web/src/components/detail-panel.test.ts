import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DetailPanel, ListWithPanel } from "@noodle/ui/components/detail-panel";
import {
	closesOnEscape,
	PANEL_STEPS,
	PANEL_WIDTHS,
	panelWidth,
	returnsFocus,
	returnTarget,
} from "@noodle/ui/lib/detail-panel";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/** The opening tag of the element with this `data-slot`. */
const tag = (html: string, slot: string) =>
	html.match(new RegExp(`<[a-z]+ [^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? "";

describe("the panel's width", () => {
	it("is a page below lg, and steps at 1024, 1280, 1440 and 1920", () => {
		expect(panelWidth("wide", 393)).toBeNull();
		expect(panelWidth("default", 1023)).toBeNull();
		expect(
			[1024, 1279, 1280, 1439, 1440, 1919, 1920, 2560].map((w) => panelWidth("wide", w)),
		).toEqual([480, 480, 560, 560, 640, 640, 800, 800]);
		expect([1024, 1280, 1440, 1920].map((w) => panelWidth("default", w))).toEqual([
			480, 480, 520, 560,
		]);
	});

	it("leaves some of the list showing at 1024 beside the open Sidebar", () => {
		// 1024 less the 248 px Sidebar is 776 px of page: a row's name is still there to click.
		expect(776 - (panelWidth("wide", 1024) ?? 0)).toBeGreaterThanOrEqual(240);
	});

	it("is the same numbers as the tokens in globals.css", () => {
		const css = readFileSync(
			fileURLToPath(new URL("../../../../packages/ui/src/styles/globals.css", import.meta.url)),
			"utf8",
		);
		// Each `@media (min-width: Nrem)` block's own text, with what comes before the first as step 0.
		const blocks = new Map<number, string>([
			[PANEL_STEPS[0], css.slice(0, css.indexOf("@media (min-width: 80rem)"))],
		]);
		for (const match of css.matchAll(/@media \(min-width: (\d+)rem\) \{\n\t:root \{([^}]*)\}/g))
			blocks.set(
				Number(match[1]) * 16,
				`${blocks.get(Number(match[1]) * 16) ?? ""}${match[2] ?? ""}`,
			);
		for (const [size, token] of [
			["default", "--detail-panel-width"],
			["wide", "--detail-panel-width-wide"],
		] as const) {
			let width: number | undefined;
			const read = PANEL_STEPS.map((from) => {
				const set = blocks.get(from)?.match(new RegExp(`${token}: (\\d+)px;`));
				if (set) width = Number(set[1]);
				return width;
			});
			expect(read, token).toEqual([...PANEL_WIDTHS[size]]);
		}
	});
});

describe("Esc", () => {
	const esc = { key: "Escape", defaultPrevented: false };
	const free = { panel: true, editing: false, layerOpen: false };

	it("closes the panel when nothing nearer has a use for it", () => {
		expect(closesOnEscape(esc, free)).toBe(true);
	});

	it("is left alone when something handled it, a field has it, or a layer is open", () => {
		expect(closesOnEscape({ ...esc, defaultPrevented: true }, free)).toBe(false);
		expect(closesOnEscape(esc, { ...free, editing: true })).toBe(false);
		expect(closesOnEscape(esc, { ...free, layerOpen: true })).toBe(false);
	});

	it("does nothing below lg, with a modifier, or for another key", () => {
		expect(closesOnEscape(esc, { ...free, panel: false })).toBe(false);
		expect(closesOnEscape({ ...esc, shiftKey: true }, free)).toBe(false);
		expect(closesOnEscape({ key: "Enter", defaultPrevented: false }, free)).toBe(false);
	});
});

describe("focus when the panel closes", () => {
	it("goes to the open item's row", () => {
		expect(
			returnTarget([
				{ picked: false, shown: true },
				{ picked: true, shown: true },
				{ picked: false, shown: true },
			]),
		).toBe(1);
	});

	it("goes to the first row in view when the item's own row is folded away or gone", () => {
		expect(
			returnTarget([
				{ picked: false, shown: false },
				{ picked: false, shown: true },
				{ picked: true, shown: false },
			]),
		).toBe(1);
		expect(returnTarget([{ picked: false, shown: true }])).toBe(0);
		expect(returnTarget([])).toBe(-1);
		expect(returnTarget([{ picked: true, shown: false }])).toBe(-1);
	});

	it("moves only when focus was in the panel or nowhere", () => {
		expect(returnsFocus("panel")).toBe(true);
		expect(returnsFocus("nowhere")).toBe(true);
		expect(returnsFocus("elsewhere")).toBe(false);
	});
});

describe("ListWithPanel", () => {
	const base = { listLabel: "Commitments", detailLabel: "Commitment details", onClose: () => {} };

	it("lays the list and the rail out the same whether or not an item is open", () => {
		const closed = renderToStaticMarkup(
			h(ListWithPanel, { ...base, list: "rows", aside: "totals" }),
		);
		const open = renderToStaticMarkup(
			h(ListWithPanel, { ...base, list: "rows", aside: "totals", detail: "Rent", size: "wide" }),
		);
		const grid = (html: string) => tag(html, "master-detail").match(/class="([^"]*)"/)?.[1];
		expect(grid(open)).toBe(grid(closed));
		expect(grid(open)).toContain("var(--rail-width)");
		expect(tag(closed, "master-detail-detail")).toBe("");
		// Below lg the item is the page: the list and the rail step aside.
		expect(tag(open, "master-detail-list")).toContain("max-lg:hidden");
		expect(tag(open, "master-detail-aside")).toContain("max-lg:hidden");
		expect(tag(closed, "master-detail-list")).not.toContain("max-lg:hidden");
	});

	it("opens the item as a labelled region on the right edge, not a dialog", () => {
		const html = renderToStaticMarkup(
			h(ListWithPanel, { ...base, list: "rows", detail: "Rent", size: "wide", close: "x" }),
		);
		const panel = tag(html, "master-detail-detail");
		expect(panel).toMatch(/^<section /);
		expect(panel).toContain('aria-label="Commitment details"');
		expect(panel).not.toMatch(/role=|aria-modal/);
		expect(panel).toContain("lg:fixed");
		expect(panel).toContain("lg:right-0");
		expect(panel).toContain("lg:w-(--detail-panel-width-wide)");
		expect(panel).toContain("lg:overflow-y-auto");
		// Every panel rule is for lg up: below it the section is plain page content.
		expect(panel).not.toMatch(/"fixed| fixed|[ "]overflow-y-auto/);
		expect(tag(html, "detail-close")).toContain("max-lg:hidden");
	});

	it("uses the narrower width unless asked for the wide one", () => {
		const html = renderToStaticMarkup(h(DetailPanel, { label: "Rule details", onClose: () => {} }));
		expect(tag(html, "master-detail-detail")).toContain("lg:w-(--detail-panel-width)");
	});
});
