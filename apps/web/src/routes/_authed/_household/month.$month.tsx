import { addMonths, type MonthKey, monthKeyAt, monthOfDay } from "@noodle/domain";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { MonthLinks, monthTitle, useMonthSwipe } from "../../../components/month-nav";
import { SectionLayout, SectionPending } from "../../../components/section-layout";
import { closingWeek } from "../../../month-close";
import { goalsQuery, monthQuery, reviewQuery, useMonthState } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

// A month of the Plan. Its pages (This Month, the Plan editor) share one cached query; This
// Month's Extra income suggestions read the Goals too, and in its first week it asks to close the
// month before.
export const Route = createFileRoute("/_authed/_household/month/$month")({
	beforeLoad: ({ params }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		return { month: params.month as MonthKey };
	},
	loader: async ({ context }) => {
		const [data] = await Promise.all([
			context.queryClient.ensureQueryData(monthQuery(context.month)),
			context.queryClient.ensureQueryData(goalsQuery()),
			// This Month says how many wait in Review.
			context.queryClient.ensureQueryData(reviewQuery()),
		]);
		if (closingWeek(context.month, data.asOf)) {
			await context.queryClient.ensureQueryData(monthQuery(addMonths(context.month, -1)));
		}
	},
	component: MonthLayout,
	pendingComponent: MonthPending,
});

/**
 * The same header as the Plan's layout (on phones the title, then the Month and Plan switch under it; previous and next in
 * the same places), so going between a month and its Plan reads as a change of tab.
 */
function MonthLayout() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const current = monthOfDay(state.asOf);
	const swipe = useMonthSwipe("/month/$month", month, state.firstMonth);
	return (
		<SectionLayout
			{...swipe}
			eyebrow={month === current ? "This Month" : "Month"}
			title={monthTitle(month, current)}
			actions={<MonthLinks to="/month/$month" month={month} first={state.firstMonth} />}
		/>
	);
}

/** A month that's slow to load: the same header, with the page's skeleton below it. */
function MonthPending() {
	const month = Route.useParams().month as MonthKey;
	// The month it is for the Household, not for the browser's clock.
	const { household } = Route.useRouteContext();
	const current = monthKeyAt(new Date(), household.timeZone);
	return (
		<SectionLayout
			eyebrow={month === current ? "This Month" : "Month"}
			title={monthTitle(month, current)}
			// Until the month loads, the first month with a Plan isn't known: both ways stay open.
			actions={<MonthLinks to="/month/$month" month={month} first={"0000-01" as MonthKey} />}
		>
			<SectionPending />
		</SectionLayout>
	);
}
