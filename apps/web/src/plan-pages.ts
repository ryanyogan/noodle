// The pages of a month's Plan: which one an address is on, and where the Buckets are. The Plan's
// first page holds the take-home split with the Buckets table under it (issue 109), so a Bucket's
// own address (`/plan/$month/buckets/$id`) belongs to that page and not to a tab of its own.

/** A page of a month's Plan with a tab: the first page, or one of its parts. */
export type PlanView =
	| "/plan/$month"
	| "/plan/$month/income"
	| "/plan/$month/commitments"
	| "/plan/$month/goals"
	| "/plan/$month/year";

/** The Buckets on the Plan's first page: `/plan/$month#buckets`. */
export const PLAN_BUCKETS_HASH = "buckets";

/**
 * The Plan's pages by the part of the address after the month. Buckets have no page of their
 * own: a Bucket is open over the first page, and the old list address redirects to it.
 */
const PLAN_PAGES: Record<string, PlanView> = {
	"": "/plan/$month",
	income: "/plan/$month/income",
	commitments: "/plan/$month/commitments",
	buckets: "/plan/$month",
	goals: "/plan/$month/goals",
	year: "/plan/$month/year",
};

/** The part of a Plan address after the month: "" on the first page, "buckets" on a Bucket. */
export function planSegment(pathname: string): string {
	return /^\/plan\/[^/]+\/([^/]+)/.exec(pathname)?.[1] ?? "";
}

/** The tabbed page an address is on, so the previous and next month open the same one. */
export function planPageOf(pathname: string): PlanView {
	return PLAN_PAGES[planSegment(pathname)] ?? "/plan/$month";
}

/**
 * Whether the first tab is the current one although the address is beneath it: with a Bucket
 * open. (On its own address the link marks itself; on Income and the rest it is not current.)
 */
export function firstTabHoldsAddress(pathname: string): boolean {
	return planSegment(pathname) === "buckets";
}

/** Where the old Buckets list address goes: the first page, at its Buckets. */
export function bucketsListRedirect(month: string) {
	return { to: "/plan/$month", params: { month }, hash: PLAN_BUCKETS_HASH } as const;
}
