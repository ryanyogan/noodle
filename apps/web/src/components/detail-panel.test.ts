import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DetailPanel, ListWithPanel } from "@noodle/ui/components/detail-panel";
import {
	closesOnEscape,
	LAYOUT_GAP,
	LAYOUT_GUTTER,
	LAYOUT_STEPS,
	PANEL_BESIDE_FROM,
	PANEL_CLEAR,
	PANEL_DRAWER,
	PANEL_FROM,
	PANEL_MAX,
	PANEL_MIN,
	panelAt,
	panelLayout,
	panelMode,
	returnsFocus,
	returnTarget,
	SIDEBAR_WIDTHS,
} from "@noodle/ui/lib/detail-panel";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/** The opening tag of the element with this `data-slot`. */
const tag = (html: string, slot: string) =>
	html.match(new RegExp(`<[a-z]+ [^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? "";

describe("the panel's width", () => {
	it("is a page below lg", () => {
		expect(panelAt("wide", 393)).toMatchObject({ mode: "page", width: null });
		expect(panelAt("default", 1023)).toMatchObject({ mode: "page", width: null });
	});

	it("is what is to the right of the list column: the rail, the gap and the gutter", () => {
		// The page fills the window beside the Sidebar at these widths, so there is no outer margin.
		expect([1280, 1439, 1440, 1688, 1920].map((w) => panelAt("wide", w))).toEqual([
			{ mode: "beside", width: 360 + 32 + 40 - 16, room: 416 },
			{ mode: "beside", width: 416, room: 416 },
			{ mode: "beside", width: 380 + 32 + 40 - 16, room: 436 },
			{ mode: "beside", width: 436, room: 436 },
			{ mode: "beside", width: 440 + 32 + 40 - 16, room: 496 },
		]);
		// Both sizes are the same until the window gives more room than the narrower one's maximum.
		expect(panelAt("default", 1440).width).toBe(436);
	});

	it("takes the margin outside the page too, when the window is wider than the page's cap", () => {
		// 1919: 1671 px beside the Sidebar for a 1440 px page, so 115.5 px a side.
		expect(panelAt("wide", 1919)).toEqual({ mode: "beside", width: 551.5, room: 551.5 });
		// 1920 with the Sidebar as icons: 1860 px for a 1680 px page, so 90 px a side.
		expect(panelAt("wide", 1920, "icons")).toEqual({ mode: "beside", width: 586, room: 586 });
		// 2560: 2312 px for a 1680 px page, 316 px a side: 812 px of room, more than either maximum.
		expect(panelAt("default", 2560)).toMatchObject({ mode: "beside", width: 640, room: 812 });
		expect(panelAt("wide", 2560)).toMatchObject({ mode: "beside", width: 800, room: 812 });
	});

	it("never covers the list column beside the list, at any width, with either Sidebar", () => {
		for (const sidebar of ["open", "icons"] as const)
			for (let w = PANEL_BESIDE_FROM; w <= 3840; w += 1) {
				const { mode, width, room } = panelAt("wide", w, sidebar);
				expect(mode, `${w} ${sidebar}`).toBe("beside");
				expect(width, `${w} ${sidebar}`).toBeLessThanOrEqual(room);
				expect(width, `${w} ${sidebar}`).toBeGreaterThanOrEqual(PANEL_MIN);
				expect(width, `${w} ${sidebar}`).toBeLessThanOrEqual(PANEL_MAX.wide);
			}
	});

	it("is a drawer where the room is under the narrowest panel that reads", () => {
		// 320 + 32 + 40 - 16 = 376 px for the panel from 1024 to 1279: under 400.
		expect(panelAt("wide", 1024)).toEqual({ mode: "drawer", width: 480, room: 376 });
		// Collapsing the Sidebar gives a margin, not a wider rail: still a drawer.
		expect(panelAt("default", 1279, "icons")).toEqual({ mode: "drawer", width: 480, room: 385.5 });
		expect(
			panelLayout({
				size: "wide",
				windowWidth: 1100,
				sidebarWidth: 248,
				pageMax: 1200,
				railWidth: 0,
			}).mode,
		).toBe("drawer");
		expect(PANEL_DRAWER).toBe(480);
	});

	it("changes mode exactly where the styles do (lg and xl)", () => {
		expect([PANEL_FROM, PANEL_BESIDE_FROM]).toEqual([1024, 1280]);
		for (const sidebar of ["open", "icons"] as const)
			for (let w = 320; w <= 2560; w += 1)
				expect(panelAt("wide", w, sidebar).mode, `${w} ${sidebar}`).toBe(panelMode(w));
	});

	it("is the same numbers as the tokens in globals.css", () => {
		const css = readFileSync(
			fileURLToPath(new URL("../../../../packages/ui/src/styles/globals.css", import.meta.url)),
			"utf8",
		);
		// Each `@media (min-width: Nrem)` block's own text, with what comes before the first as 0.
		const blocks = new Map<number, string>([[0, css.slice(0, css.indexOf("@media (min-width:"))]]);
		for (const match of css.matchAll(/@media \(min-width: (\d+)rem\) \{\n\t:root \{([^}]*)\}/g))
			blocks.set(
				Number(match[1]) * 16,
				`${blocks.get(Number(match[1]) * 16) ?? ""}${match[2] ?? ""}`,
			);
		/** The token's value in a window this wide. */
		const token = (name: string, windowWidth: number) => {
			let value: number | undefined;
			for (const from of [...blocks.keys()].sort((x, y) => x - y)) {
				if (from > windowWidth) break;
				const set = blocks.get(from)?.match(new RegExp(`${name}: (\\d+)px;`));
				if (set) value = Number(set[1]);
			}
			return value;
		};
		for (const step of LAYOUT_STEPS) {
			expect(token("--shell-max", step.from), `--shell-max at ${step.from}`).toBe(step.pageMax);
			expect(token("--rail-width", step.from), `--rail-width at ${step.from}`).toBe(step.rail);
			expect(token("--layout-gap", step.from)).toBe(LAYOUT_GAP);
			expect(token("--gutter", step.from)).toBe(LAYOUT_GUTTER);
			expect(token("--sidebar-width", step.from)).toBe(SIDEBAR_WIDTHS.open);
			expect(token("--sidebar-width-icon", step.from)).toBe(SIDEBAR_WIDTHS.icons);
		}
		// No step of the layout's tokens between the ones mirrored.
		for (const from of blocks.keys())
			if (
				from >= PANEL_FROM &&
				/--(shell-max|rail-width|gutter|layout-gap):/.test(blocks.get(from) ?? "")
			)
				expect(LAYOUT_STEPS.map((step) => step.from)).toContain(from);
		expect(token("--detail-panel-min", 0)).toBe(PANEL_MIN);
		expect(token("--detail-panel-clear", 0)).toBe(PANEL_CLEAR);
		expect(token("--detail-panel-max", 0)).toBe(PANEL_MAX.default);
		expect(token("--detail-panel-max-wide", 0)).toBe(PANEL_MAX.wide);
		expect(token("--detail-panel-drawer", 0)).toBe(PANEL_DRAWER);
		// The width's own rule: the same sum, between the same limits.
		for (const [utility, max] of [
			["w-detail-panel", "--detail-panel-max"],
			["w-detail-panel-wide", "--detail-panel-max-wide"],
		] as const) {
			const rule = css.match(new RegExp(`@utility ${utility} \\{([^}]*)\\}`))?.[1] ?? "";
			expect(rule.replace(/\s+/g, " "), utility).toContain(
				`width: clamp( var(--detail-panel-min), calc( var(--rail-width) + var(--layout-gap) + var(--gutter) - var(--detail-panel-clear) + max(0px, (100% - var(--sidebar-width) - var(--shell-max)) / 2) ), var(${max}) );`,
			);
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

	it("opens the item as a labelled region on the right edge, sized by the layout", () => {
		const html = renderToStaticMarkup(
			h(ListWithPanel, { ...base, list: "rows", detail: "Rent", size: "wide", close: "x" }),
		);
		const panel = tag(html, "master-detail-detail");
		expect(panel).toMatch(/^<section /);
		expect(panel).toContain('aria-label="Commitment details"');
		// The server's HTML is the same at every width: it is a dialog only once the window says
		// it is a drawer.
		expect(panel).not.toMatch(/role=|aria-modal/);
		expect(panel).toContain("lg:fixed");
		expect(panel).toContain("lg:right-0");
		expect(panel).toContain("xl:w-detail-panel-wide");
		expect(panel).toContain("lg:w-[min(var(--detail-panel-drawer),100%)]");
		expect(panel).toContain("lg:bg-popover");
		expect(panel).toContain("lg:border-border-strong");
		expect(panel).toContain("lg:shadow-side");
		expect(panel).toContain("lg:overflow-y-auto");
		// Every panel rule is for lg up: below it the section is plain page content.
		expect(panel).not.toMatch(/"fixed| fixed|[ "]overflow-y-auto/);
		expect(tag(html, "detail-close")).toContain("max-lg:hidden");
	});

	it("has a scrim only where it is a drawer, from lg to xl", () => {
		const html = renderToStaticMarkup(h(DetailPanel, { label: "Rule details", onClose: () => {} }));
		const scrim = html.match(/<div [^>]*data-panel-scrim=""[^>]*>/)?.[0] ?? "";
		expect(scrim).toContain('aria-hidden="true"');
		expect(scrim).toMatch(/ hidden /);
		expect(scrim).toContain("lg:max-xl:block");
		expect(scrim).toContain("bg-scrim");
	});

	it("uses the narrower maximum unless asked for the wide one", () => {
		const html = renderToStaticMarkup(h(DetailPanel, { label: "Rule details", onClose: () => {} }));
		expect(tag(html, "master-detail-detail")).toMatch(/xl:w-detail-panel[ "]/);
	});
});
