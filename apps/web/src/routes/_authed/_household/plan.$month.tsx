import { type MonthKey, monthKeyAt, monthOfDay } from "@noodle/domain";
import { createFileRoute, linkOptions, notFound, useLocation } from "@tanstack/react-router";
import {
	MonthLinks,
	MonthTopRow,
	monthTitle,
	type PlanView,
	useMonthSwipe,
} from "../../../components/month-nav";
import { SectionLayout, SectionPending, type SectionTab } from "../../../components/section-layout";
import { monthQuery, useMonthState } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

// A month's Plan: its overview and the pages for each part of it, all reading the month's one
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

/** The Plan's pages, in the order of their tabs: the last part of each one's URL, and its route. */
const PLAN_PAGES: { segment: string; to: PlanView }[] = [
	{ segment: "", to: "/plan/$month" },
	{ segment: "income", to: "/plan/$month/income" },
	{ segment: "commitments", to: "/plan/$month/commitments" },
	{ segment: "buckets", to: "/plan/$month/buckets" },
	{ segment: "goals", to: "/plan/$month/goals" },
	{ segment: "year", to: "/plan/$month/year" },
];

const planTabs = (month: MonthKey): SectionTab[] => [
	{ label: "Overview", link: linkOptions({ to: "/plan/$month", params: { month } }) },
	{ label: "Income", link: linkOptions({ to: "/plan/$month/income", params: { month } }) },
	{
		label: "Commitments",
		link: linkOptions({ to: "/plan/$month/commitments", params: { month } }),
	},
	{ label: "Buckets", link: linkOptions({ to: "/plan/$month/buckets", params: { month } }) },
	{ label: "Goal funding", link: linkOptions({ to: "/plan/$month/goals", params: { month } }) },
	{ label: "Year", link: linkOptions({ to: "/plan/$month/year", params: { month } }) },
];

/** The Plan page being shown, so the previous and next month open the same one. */
function usePlanPage(): PlanView {
	const segment = useLocation({
		select: (location) => /^\/plan\/[^/]+\/([^/]+)/.exec(location.pathname)?.[1] ?? "",
	});
	return PLAN_PAGES.find((page) => page.segment === segment)?.to ?? "/plan/$month";
}

function PlanLayout() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const to = usePlanPage();
	const swipe = useMonthSwipe(to, month, state.firstMonth);
	return (
		<SectionLayout
			{...swipe}
			top={<MonthTopRow month={month} current="plan" />}
			eyebrow="Plan"
			title={monthTitle(month, monthOfDay(state.asOf))}
			actions={<MonthLinks to={to} month={month} first={state.firstMonth} />}
			tabsLabel="Plan pages"
			tabs={planTabs(month)}
		/>
	);
}

/** A month that's slow to load: the same header and tabs, with the page's skeleton below them. */
function PlanPending() {
	const month = Route.useParams().month as MonthKey;
	// The month it is for the Household, not for the browser's clock.
	const { household } = Route.useRouteContext();
	const to = usePlanPage();
	return (
		<SectionLayout
			top={<MonthTopRow month={month} current="plan" />}
			eyebrow="Plan"
			title={monthTitle(month, monthKeyAt(new Date(), household.timeZone))}
			// Until the month loads, the first month with a Plan isn't known: both ways stay open.
			actions={<MonthLinks to={to} month={month} first={"0000-01" as MonthKey} />}
			tabsLabel="Plan pages"
			tabs={planTabs(month)}
		>
			<SectionPending />
		</SectionLayout>
	);
}
