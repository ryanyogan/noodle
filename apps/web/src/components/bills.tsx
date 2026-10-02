import type { CommitmentState, DayKey, MonthKey } from "@noodle/domain";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@noodle/ui/components/tabs";
import { useState, useSyncExternalStore } from "react";
import { ComingUpList, useComingUp } from "./coming-up";
import { CommitmentsList, commitmentsPaid } from "./commitment-list";

// Bills on This Month (#47): the month's Commitments, paid or due, and what's coming up in the
// next 30 days were two lists of the same bills one after the other. Now one section switches
// between them. An ended month has only its own. From lg, Coming up sits in This Month's right
// rail (ComingUpSection) and Bills shows only the month's.

const lgQuery = "(min-width: 64rem)";

/** Whether the window is lg or wider. The server renders the phone layout. */
export function useLg() {
	return useSyncExternalStore(
		(onChange) => {
			const query = window.matchMedia(lgQuery);
			query.addEventListener("change", onChange);
			return () => query.removeEventListener("change", onChange);
		},
		() => window.matchMedia(lgQuery).matches,
		() => false,
	);
}

type View = "month" | "coming-up";

/** The month's bills, and in the current month what's coming up, one view at a time. */
export function Bills({
	month,
	asOf,
	current,
	commitments,
	notDue,
}: {
	month: MonthKey;
	asOf: DayKey;
	/** The Household's current month: only it has a Coming up. */
	current: boolean;
	commitments: CommitmentState[];
	notDue: CommitmentState[];
}) {
	const [view, setView] = useState<View>("month");
	const paid = commitmentsPaid(commitments);
	const lg = useLg();
	const switched = current && !lg;
	const shown = switched ? view : "month";
	return (
		<Section aria-labelledby="bills-title" id="bills" className="scroll-mt-6">
			<SectionHeader
				id="bills-title"
				title="Bills"
				count={commitments.length}
				action={
					shown === "month" && paid ? (
						<span className="text-[13px] text-muted-foreground tabular-nums">{paid}</span>
					) : (
						<span className="text-[13px] text-muted-foreground">Next 30 days</span>
					)
				}
			/>
			{switched ? (
				<Tabs
					value={view}
					onValueChange={(value) => setView(value === "coming-up" ? value : "month")}
				>
					<BillsSwitch />
					<TabsContent value="month" className="grid gap-3">
						<CommitmentsList month={month} asOf={asOf} commitments={commitments} notDue={notDue} />
					</TabsContent>
					<TabsContent value="coming-up" className="grid gap-3">
						<ComingUpList />
					</TabsContent>
				</Tabs>
			) : (
				<CommitmentsList month={month} asOf={asOf} commitments={commitments} notDue={notDue} />
			)}
		</Section>
	);
}

/** Coming up in This Month's right rail, from lg: the next 30 days' bills. */
export function ComingUpSection() {
	return (
		<Section aria-labelledby="coming-up-title">
			<SectionHeader
				id="coming-up-title"
				title="Coming up"
				action={<span className="text-[13px] text-muted-foreground">Next 30 days</span>}
			/>
			<ComingUpList />
		</Section>
	);
}

/** "This month · Coming up": the two tabs, with how many are coming up. */
function BillsSwitch() {
	const { dues } = useComingUp();
	return (
		<TabsList aria-label="Bills">
			<TabsTrigger value="month">This month</TabsTrigger>
			<TabsTrigger value="coming-up">
				Coming up{dues.length > 0 ? ` (${dues.length})` : ""}
			</TabsTrigger>
		</TabsList>
	);
}
