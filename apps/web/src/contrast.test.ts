/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	HEAT_BASE,
	HEAT_TOP,
	HEAT_TOP_CLASS,
	heatPercent,
	incomeSpendConfig,
} from "./components/report-charts";

// Text tokens against every surface they're drawn on, in both themes: WCAG 2.2 AA (1.4.3) needs
// 4.5:1 for normal text. The tokens live in packages/ui's globals.css.

const css = readFileSync(
	join(import.meta.dirname, "..", "..", "..", "packages", "ui", "src", "styles", "globals.css"),
	"utf8",
);

/** The hex colour tokens in the first `:root { … }` block after `from`. */
function tokens(from: number): Record<string, string> {
	const start = css.indexOf(":root {", from);
	const block = css.slice(start, css.indexOf("}", start));
	return Object.fromEntries(
		[...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [name, hex]),
	);
}

const light = tokens(0);
// The rule itself, with its brace: `@custom-variant dark (@media (prefers-color-scheme: dark))` comes
// first in the file, and finding that one read the light block twice.
const dark = { ...light, ...tokens(css.indexOf("@media (prefers-color-scheme: dark) {")) };

it("reads the dark tokens, not the light ones again", () => {
	expect(dark.card).not.toBe(light.card);
});

const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};

/** `soft` (an rgb(… / alpha) tint of `over`) laid over `under`. */
const tint = (over: string, alpha: number, under: string) =>
	`#${[1, 3, 5]
		.map((i) => {
			const top = Number.parseInt(over.slice(i, i + 2), 16);
			const bottom = Number.parseInt(under.slice(i, i + 2), 16);
			return Math.round(top * alpha + bottom * (1 - alpha))
				.toString(16)
				.padStart(2, "0");
		})
		.join("")}`;

describe.each([
	["light", light, 0.1],
	["dark", dark, 0.14],
])("text contrast, %s theme", (_theme, t, overAlpha) => {
	const surfaces = ["card", "background", "surface-2", "surface-3"];

	it.each(["foreground", "muted-foreground", "subtle-foreground"])(
		"%s is at least 4.5:1 on every surface",
		(text) => {
			for (const surface of surfaces) {
				expect(contrast(t[text] as string, t[surface] as string)).toBeGreaterThanOrEqual(4.5);
			}
		},
	);

	it("a bar's Today line and over fill are at least 3:1 on its track (BudgetBar, #64)", () => {
		for (const ink of ["foreground", "over"]) {
			expect(contrast(t[ink] as string, t["surface-3"] as string)).toBeGreaterThanOrEqual(3);
		}
	});

	it("every Bucket colour is at least 3:1 on the bar track (#64)", () => {
		for (let i = 1; i <= 8; i++) {
			expect(contrast(t[`bucket-${i}`] as string, t["surface-3"] as string)).toBeGreaterThanOrEqual(
				3,
			);
		}
	});

	it("an empty Checkbox, Radio or off Switch has an edge of at least 3:1 where it sits (ADR-0038)", () => {
		// They're drawn with --input on a card, the page or a raised row (surface-2).
		for (const surface of ["card", "background", "surface-2"]) {
			expect(contrast(t.input as string, t[surface] as string)).toBeGreaterThanOrEqual(3);
		}
	});

	it("the Over badge's text is at least 4.5:1 on its tint, over a card", () => {
		const badge = tint(t.over as string, overAlpha, t.card as string);
		expect(contrast(t["over-foreground"] as string, badge)).toBeGreaterThanOrEqual(4.5);
	});
});

describe("chart contrast, dark theme (#73)", () => {
	it("the comparison series (Explore's Plan bars) is at least 3:1 on the card, and quieter than the Scenario's", () => {
		const compare = dark["chart-compare"] as string;
		expect(contrast(compare, dark.card as string)).toBeGreaterThanOrEqual(3);
		expect(contrast(dark.brand as string, dark.card as string)).toBeGreaterThan(
			contrast(compare, dark.card as string) * 2,
		);
	});

	it("an off Switch's dark thumb (the card colour) is at least 3:1 on its track (--input)", () => {
		expect(contrast(dark.card as string, dark.input as string)).toBeGreaterThanOrEqual(3);
	});

	it("Cash flow's nodes (the two quieter text greys) are at least 3:1 on the card", () => {
		for (const node of ["muted-foreground", "subtle-foreground"]) {
			expect(contrast(dark[node] as string, dark.card as string)).toBeGreaterThanOrEqual(3);
		}
	});
});

// Two pairs of chart marks that no dark grey can separate: there the mark changes, not the colour.
describe("chart marks told apart by shape, dark theme (#73)", () => {
	const darkAt = css.indexOf("@media (prefers-color-scheme: dark) {");

	it("the glance's Goals part is hollow in dark: its edge is at least 3:1 on the card, and the card inside it at least 3:1 from the parts beside it", () => {
		const block = css.slice(darkAt);
		expect(block).toMatch(/--chart-goal:\s*transparent;/);
		expect(block).toMatch(/--chart-goal-edge:\s*var\(--chart-compare\);/);
		expect(contrast(dark["chart-compare"] as string, dark.card as string)).toBeGreaterThanOrEqual(
			3,
		);
		// "Spent from Buckets" and "Left in Buckets" before it, Free to Spend after it.
		for (const beside of ["chart-allowance", "brand"]) {
			expect(contrast(dark.card as string, dark[beside] as string)).toBeGreaterThanOrEqual(3);
		}
		// Why a fill won't do: the comparison grey is nearly the Bucket parts' grey.
		expect(
			contrast(dark["chart-compare"] as string, dark["chart-allowance"] as string),
		).toBeLessThan(1.5);
	});

	it("the glance's Goals part is still the filled comparison grey in light, with no edge", () => {
		const block = css.slice(0, darkAt);
		expect(block).toMatch(/--chart-goal:\s*var\(--chart-compare\);/);
		expect(block).toMatch(/--chart-goal-edge:\s*transparent;/);
	});

	it("Reports' Left over has a line for its legend key, where Earned and Spent have squares", () => {
		// Ink beside the Spent grey is under 3:1 in dark, so two squares would read as one series.
		expect(contrast(dark.foreground as string, dark["chart-spend"] as string)).toBeLessThan(3);
		expect(incomeSpendConfig.net.icon).toBeTypeOf("function");
		expect("icon" in incomeSpendConfig.spent).toBe(false);
		expect("icon" in incomeSpendConfig.earned).toBe(false);
	});
});

// Plan vs actual's heat cells (#73): the fill is `color-mix(in oklab, over|brand N%, card)` and the
// words on it are the main ink. Mixed here the way the browser mixes it, then measured.
type Triple = [number, number, number];
const linear = (hex: string) =>
	[1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as Triple;
const toOklab = ([r, g, b]: Triple): Triple => {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
};
/** The luminance of `share` (0 to 1) of `colour` mixed in oklab into `base`. */
const mixedLuminance = (colour: string, share: number, base: string) => {
	const a = toOklab(linear(colour));
	const b = toOklab(linear(base));
	const [L, A, B] = a.map((v, i) => v * share + (b[i] as number) * (1 - share)) as Triple;
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	const [r, g, bl] = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map((c) => Math.min(1, Math.max(0, c))) as Triple;
	return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

it("the heat cells' class sets the tops the test measures", () => {
	expect(HEAT_TOP_CLASS).toBe(`[--heat-top:${HEAT_TOP.light}] dark:[--heat-top:${HEAT_TOP.dark}]`);
});

describe.each([
	["light", light, HEAT_TOP.light],
	["dark", dark, HEAT_TOP.dark],
])("Plan vs actual heat cells, %s theme", (_theme, t, top) => {
	const ink = luminance(t.foreground as string);
	const fill = (colour: "over" | "brand", off: number) =>
		mixedLuminance(t[colour] as string, heatPercent(off, top) / 100, t.card as string);

	// 0.1 off the Plan is the weakest tinted cell; 0.87 is where white and dark words used to cross
	// in dark, both under 4.5:1; 1 (double the allowance, or nothing spent) is the strongest.
	it.each([
		["weakest", 0.1],
		["halfway", 0.5],
		["old crossover", 0.87],
		["strongest", 1],
		["past the top", 2.5],
	])("the words are at least 4.5:1 on the %s cell, red and indigo", (_name, off) => {
		for (const colour of ["over", "brand"] as const) {
			expect(ratio(ink, fill(colour, off))).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("the words are at least 4.5:1 on every strength in between", () => {
		for (const colour of ["over", "brand"] as const) {
			for (let off = 0.1; off <= 1; off += 0.01) {
				expect(ratio(ink, fill(colour, off))).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("the strongest cell still stands at least 3:1 off the card, and the weakest is the base", () => {
		const card = luminance(t.card as string);
		for (const colour of ["over", "brand"] as const) {
			expect(ratio(card, fill(colour, 1))).toBeGreaterThanOrEqual(3);
		}
		expect(heatPercent(0, top)).toBe(HEAT_BASE);
		expect(heatPercent(1, top)).toBe(top);
	});
});

// The sequential scale (#73): Trends' "Every day" calendar fills a day with one of four steps of
// `color-mix(in oklab, brand N%, card)`; a day with no spending is --surface-2. Each step has to be
// told from an empty day and from the step beside it, in the calendar and in its "Less … More" key.
const seqShares = (from: number) => {
	const start = css.indexOf(":root {", from);
	const block = css.slice(start, css.indexOf("}", start));
	return [1, 2, 3].map((step) => {
		const share = block.match(
			new RegExp(
				`--chart-seq-${step}:\\s*color-mix\\(in oklab, var\\(--brand\\) (\\d+)%, var\\(--card\\)\\);`,
			),
		)?.[1];
		expect(share, `--chart-seq-${step}`).toBeDefined();
		return Number(share) / 100;
	});
};

describe.each([
	["light", light, 0],
	["dark", dark, css.indexOf("@media (prefers-color-scheme: dark) {")],
])("the sequential scale (Trends' Every day), %s theme (#73)", (_theme, t, from) => {
	const steps = [
		...seqShares(from).map((share) => mixedLuminance(t.brand as string, share, t.card as string)),
		luminance(t.brand as string),
	];
	const card = luminance(t.card as string);
	const empty = luminance(t["surface-2"] as string);

	it("the lowest step is at least 1.5:1 from an empty day", () => {
		expect(ratio(steps[0] as number, empty)).toBeGreaterThanOrEqual(1.5);
	});

	it("each step is at least 1.3:1 from the one before it", () => {
		for (let i = 1; i < steps.length; i++) {
			expect(ratio(steps[i] as number, steps[i - 1] as number)).toBeGreaterThanOrEqual(1.3);
		}
	});

	it("the steps move one way, away from the card", () => {
		const off = [ratio(empty, card), ...steps.map((step) => ratio(step, card))];
		expect(off).toEqual([...off].sort((a, b) => a - b));
	});
});

// Big expenses' "What did we spend over…" (#73): the bars under the chosen amount are
// --chart-allowance and the counted ones --chart-spend.
describe.each([
	["light", light],
	["dark", dark],
])("Big expenses' bars, %s theme (#73)", (_theme, t) => {
	it("the bars under the chosen amount are at least 3:1 on the card, and 3:1 from the counted ones", () => {
		expect(contrast(t["chart-allowance"] as string, t.card as string)).toBeGreaterThanOrEqual(3);
		expect(
			contrast(t["chart-spend"] as string, t["chart-allowance"] as string),
		).toBeGreaterThanOrEqual(3);
	});
});
