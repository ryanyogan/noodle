import { EmptyState } from "@noodle/ui/components/empty-state";
import { PageHeader } from "@noodle/ui/components/page-header";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { monthName } from "../../../format";
import { thisMonthQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

export const Route = createFileRoute("/_authed/_household/month/$month")({
	beforeLoad: ({ params }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
	},
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(thisMonthQuery(params.month)),
	component: ThisMonth,
});

function ThisMonth() {
	const { month } = Route.useParams();
	const { data } = useSuspenseQuery(thisMonthQuery(month));
	return (
		<>
			<PageHeader eyebrow="This Month" title={monthName(data.month)} />
			{data.buckets.length === 0 ? (
				<EmptyState
					icon={<CalendarDays />}
					title="Nothing planned yet"
					description="Your Buckets will appear here once the Plan is set up."
				/>
			) : null}
		</>
	);
}
