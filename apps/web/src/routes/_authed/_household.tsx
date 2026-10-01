import { monthKeyAt } from "@noodle/domain";
import { Toaster } from "@noodle/ui/components/toast";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "../../components/app-shell";
import { LeaveGuard } from "../../components/leave-guard";
import { QuickAdd } from "../../components/quick-add";
import { useLiveUpdates } from "../../live-updates";
import { useKeepPushSubscription } from "../../push-device";
import { bucketUsesQuery, membersQuery, monthQuery } from "../../queries";

// The authenticated app layout: requires the Parent to belong to a Household.
export const Route = createFileRoute("/_authed/_household")({
	// `sheet` opens a sheet over whichever page is showing.
	validateSearch: z.object({ sheet: z.enum(["quick-add"]).optional().catch(undefined) }),
	beforeLoad: ({ context }) => {
		if (!context.household || !context.parentId) throw redirect({ to: "/welcome" });
		return { household: context.household, parentId: context.parentId };
	},
	// Quick Add can open from any page; have what it shows ready (not awaited, so pages don't wait).
	loader: ({ context }) => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		void context.queryClient.prefetchQuery(monthQuery(month));
		void context.queryClient.prefetchQuery(bucketUsesQuery());
		void context.queryClient.prefetchQuery(membersQuery());
	},
	component: AppLayout,
});

function AppLayout() {
	const { household, parentId } = Route.useRouteContext();
	useLiveUpdates();
	useKeepPushSubscription();
	return (
		<>
			<AppShell householdName={household.name}>
				<Outlet />
			</AppShell>
			{/* Outside the frame: while a sheet is open the whole frame is hidden from assistive tech
			    as one element, and the Toaster (a live region, which stays exposed) isn't inside it. */}
			<QuickAdd timeZone={household.timeZone} parentId={parentId} />
			<LeaveGuard />
			<Toaster />
		</>
	);
}
