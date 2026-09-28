import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { monthLabel } from "../../../format";
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
		<main>
			<h1>This Month</h1>
			<p>{monthLabel(data.month)}</p>
			{data.buckets.length === 0 ? (
				<p>Nothing planned yet. Your Buckets will appear here.</p>
			) : null}
		</main>
	);
}
