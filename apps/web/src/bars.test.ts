import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { monthState } from "@noodle/domain";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { barState } from "./buckets";

// The one bar rule (#64, ADR-0025, packages/ui/COMPONENTS.md "BudgetBar"): every bar in apps/web is
// BudgetBar. Meter and Progress are gone, and a bar drawn by hand (a fill sized with an inline
// `width` or a translateX/scaleX transform) fails here. Reports' recharts bars are charts, not this bar.
const root = join(import.meta.dirname, ".");

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
	});
}

// A hand-drawn bar: a fill sized inline. Add a file only with a reason.
const DRAWN_ALLOWED: Record<string, { count: number; why: string }> = {
	"components/quick-add.tsx": { count: 2, why: "a shake animation's keyframes, not a bar" },
	"components/month-glance.tsx": {
		count: 1,
		why: "the Month glance: one stacked bar of where take-home pay goes, several segments, which BudgetBar (one fill) can't draw",
	},
};
const DRAWN = /\bflexGrow:|\bwidth:\s*(?:`|pct\(|[\w.]+\s*\*\s*100)|translateX\(|scaleX\(/g;
const RETIRED = /@noodle\/ui\/components\/(?:meter|progress)["']/;

describe("the one bar rule", () => {
	const files = sources(root).map((path) => ({
		file: relative(root, path),
		text: readFileSync(path, "utf8"),
	}));

	it("nothing imports Meter or Progress (they're folded into BudgetBar)", () => {
		expect(files.filter((f) => RETIRED.test(f.text)).map((f) => f.file)).toEqual([]);
	});

	it("no bar is drawn by hand: a new one is BudgetBar", () => {
		const found = files
			.map((f) => ({ file: f.file, count: f.text.match(DRAWN)?.length ?? 0 }))
			.filter((f) => f.count > 0);
		const over = found.filter((f) => f.count > (DRAWN_ALLOWED[f.file]?.count ?? 0));
		expect(over).toEqual([]);
		const stale = Object.entries(DRAWN_ALLOWED).filter(
			([file, { count }]) => (found.find((f) => f.file === file)?.count ?? 0) < count,
		);
		expect(stale.map(([file]) => file)).toEqual([]);
	});
});

describe("BudgetBar and the badge agree at the Pace tolerance edge (#64)", () => {
	// 30-day month, $300 Available: by the 10th Pace says $100 spent; 3% of $300 is $9.
	const bucketAfter = (spent: number) => {
		const state = monthState({
			plan: {
				month: "2026-09",
				baseline: 500_000,
				commitments: [],
				buckets: [{ id: "b", name: "Groceries", color: 1, allowance: 30_000, rolling: false }],
			},
			asOf: "2026-09-10",
			spending: [{ bucketId: "b", amount: spent, date: "2026-09-05" }],
		});
		const bucket = state.buckets[0];
		if (!bucket) throw new Error("no Bucket");
		return bucket;
	};
	const barFor = (spent: number) => {
		const bucket = bucketAfter(spent);
		return renderToStaticMarkup(
			h(BudgetBar, {
				value: bucket.spent,
				max: bucket.available,
				marker: 1 - bucket.pace.leftShare,
				state: barState(bucket.status),
				label: bucket.name,
				valueText: "",
			}),
		);
	};

	it.each([
		[10_900, false], // just inside: on Pace, no badge, no stripe
		[10_901, true], // just outside: "Ahead of pace" badge, and the stripe past Today
	])("spending %i¢: ahead is %s on both", (spent, ahead) => {
		const badge = bucketAfter(spent).status === "ahead";
		const html = barFor(spent);
		expect(badge).toBe(ahead);
		expect(html.includes('data-slot="budget-bar-ahead"')).toBe(ahead);
		expect(html.includes('data-state="ahead"')).toBe(ahead);
	});

	it("over fills the bar in the over ink, and a meter carries the value", () => {
		const html = barFor(30_001);
		expect(html).toContain('data-state="over"');
		expect(html).toContain('role="meter"');
		expect(html).not.toContain('data-slot="budget-bar-ahead"');
	});
});
