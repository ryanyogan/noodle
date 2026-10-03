import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { exportStatusQuery } from "../queries";
import { prepareExport } from "../server/export";

/** "3:40 PM tomorrow": when a download stops working, in the Parent's own time. */
export function readyUntil(expiresAt: number, now: Date = new Date()): string {
	const until = new Date(expiresAt);
	const time = until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
	const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((dayOf(until) - dayOf(now)) / 86_400_000);
	return days === 0
		? `${time} today`
		: days === 1
			? `${time} tomorrow`
			: until.toLocaleString("en-US");
}

/**
 * Download your data: a ZIP of the Household's spending, Plan, Rules and stored files, as this
 * Parent sees them. Prepared in the background; the link works for 24 hours, for this Parent only.
 */
export function DataDownload() {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const status = useQuery({
		...exportStatusQuery(),
		// The Household Agent says when it's ready; this is the fallback if that message is missed.
		refetchInterval: (query) => (query.state.data?.state === "preparing" ? 5000 : false),
	});
	const prepare = useMutation({
		mutationFn: () => prepareExport(),
		onSuccess: (next) => queryClient.setQueryData(exportStatusQuery().queryKey, next),
		onError: () =>
			toast("Couldn’t start preparing your download.", {
				tone: "error",
				action: { label: "Retry", onClick: () => prepare.mutate() },
			}),
	});
	const state = status.data;

	return (
		<Section aria-labelledby="download-data">
			<SectionHeader id="download-data" title="Download your data" />
			<Card className="grid gap-3 p-(--card-pad)">
				<div className="flex items-start gap-3 text-sm">
					<Tile>
						<Download />
					</Tile>
					<div className="grid gap-1">
						<p>
							A ZIP file with your Transactions, Accounts, Plan by month, Plan changes and Rules as
							spreadsheets, plus your statements and receipts.
						</p>
						<p className="text-muted-foreground">
							The other Parent’s Personal Allowance isn’t included, only its total each month. The
							link works for 24 hours, and only for you.
						</p>
					</div>
				</div>
				{state?.state === "ready" ? (
					<Button asChild className="sm:justify-self-start">
						<a href={`/download-your-data/${state.id}.zip`} download>
							Download (ready until {readyUntil(state.expiresAt)})
						</a>
					</Button>
				) : (
					<Button
						className="sm:justify-self-start"
						disabled={!hydrated || !state || state.state === "preparing" || prepare.isPending}
						onClick={() => prepare.mutate()}
					>
						{state?.state === "preparing" || prepare.isPending ? "Preparing…" : "Prepare download"}
					</Button>
				)}
			</Card>
		</Section>
	);
}
