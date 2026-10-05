import { type MonthKey, monthKeyAt, monthOfDay } from "@noodle/domain";
import { createFileRoute, linkOptions, notFound, useLocation } from "@tanstack/react-router";
import { MonthLinks, monthTitle, useMonthSwipe } from "../../../components/month-nav";
import { SectionLayout, SectionPending, type SectionTab } from "../../../components/section-layout";
import { firstTabHoldsAddress, type PlanView, planPageOf } from "../../../plan-pages";
import { monthQuery, useMonthState } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

// A month's Plan: its first page (the split and the Buckets) and the pages for each other part, all reading the month's one
// cached query (shared with This Month), so a change shows everywhere at once. The header and the
// tabs live here, once; each page renders only what's below them.
export const Route = createFileRoute("/_authed/_household/plan/$month")({
	beforeLoad: ({ params }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		return { month: params.month as MonthKey };
	},
	loader: ({ context }) => context.queryClient.ensureQueryData(monthQuery(context.month)),
	component: PlanLayout,
	pendingComponent: PlanPending,
});

const planTabs = (month: MonthKey, onBucket: boolean): SectionTab[] => [
	{
		label: "Overview",
		link: linkOptions({ to: "/plan/$month", params: { month } }),
		// A Bucket opens over this page, at an address beneath it: the tab is still the current one.
		current: onBucket,
	},
	{ label: "Income", link: linkOptions({ to: "/plan/$month/income", params: { month } }) },
	{
		label: "Commitments",
		link: linkOptions({ to: "/plan/$month/commitments", params: { month } }),
	},
	{ label: "Goal funding", link: linkOptions({ to: "/plan/$month/goals", params: { month } }) },
	{ label: "Year", link: linkOptions({ to: "/plan/$month/year", params: { month } }) },
];

/** The Plan page being shown, so the previous and next month open the same one. */
function usePlanPage(): { to: PlanView; onBucket: boolean } {
	const pathname = useLocation({ select: (location) => location.pathname });
	return { to: planPageOf(pathname), onBucket: firstTabHoldsAddress(pathname) };
}

function PlanLayout() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const { to, onBucket } = usePlanPage();
	const swipe = useMonthSwipe(to, month, state.firstMonth);
	return (
		<SectionLayout
			{...swipe}
			eyebrow="Plan"
			title={monthTitle(month, monthOfDay(state.asOf))}
			actions={<MonthLinks to={to} month={month} first={state.firstMonth} />}
			tabsLabel="Plan pages"
			tabs={planTabs(month, onBucket)}
		/>
	);
}

/** A month that's slow to load: the same header and tabs, with the page's skeleton below them. */
function PlanPending() {
	const month = Route.useParams().month as MonthKey;
	// The month it is for the Household, not for the browser's clock.
	const { household } = Route.useRouteContext();
	const { to, onBucket } = usePlanPage();
	return (
		<SectionLayout
			eyebrow="Plan"
			title={monthTitle(month, monthKeyAt(new Date(), household.timeZone))}
			// Until the month loads, the first month with a Plan isn't known: both ways stay open.
			actions={<MonthLinks to={to} month={month} first={"0000-01" as MonthKey} />}
			tabsLabel="Plan pages"
			tabs={planTabs(month, onBucket)}
		>
			<SectionPending />
		</SectionLayout>
	);
}
