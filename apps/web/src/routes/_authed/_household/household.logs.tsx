import { PageLayout } from "@noodle/ui/components/layout";
import { SectionGroup } from "@noodle/ui/components/section";
import { createFileRoute } from "@tanstack/react-router";
import {
	HouseholdLog,
	LOG_HASH,
	logQuery,
	logSearchSchema,
} from "../../../components/household-log";
import { SectionPending } from "../../../components/section-layout";
import { householdParentsQuery } from "../../../queries";

// Household settings › Logs: the Log, every change made to the Household in one table that has
// the page's width (issue 139). It was a group of the settings page until issue 157.
export const Route = createFileRoute("/_authed/_household/household/logs")({
	validateSearch: logSearchSchema,
	loaderDeps: ({ search }) => ({ month: search.month, who: search.who, kind: search.kind }),
	loader: async ({ context, deps }) => {
		await Promise.all([
			// The Log's first page comes with the page, so a link to it lands on its rows.
			context.queryClient.prefetchInfiniteQuery(logQuery(deps)),
			context.queryClient.ensureQueryData(householdParentsQuery()),
		]);
	},
	component: LogsPage,
	pendingComponent: SectionPending,
});

function LogsPage() {
	const filters = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<PageLayout>
			<SectionGroup id={LOG_HASH} title="Log">
				<p className="text-sm text-muted-foreground">
					Every change to the Plan, who made it and when, with Rules made and removed, snapshots,
					Fresh starts, Bank Connections connected and disconnected, and Accounts archived. Newest
					first unless you sort it. A Fresh start clears the changes before it; the Fresh start,
					your snapshots and what had been removed stay listed.
				</p>
				<HouseholdLog
					filters={filters}
					onFilter={(next) => navigate({ search: next, replace: true, resetScroll: false })}
				/>
			</SectionGroup>
		</PageLayout>
	);
}
