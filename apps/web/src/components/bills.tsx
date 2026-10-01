import type { CommitmentState, DayKey, MonthKey } from "@noodle/domain";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { type KeyboardEvent, useRef, useState } from "react";
import { ComingUpList, useComingUp } from "./coming-up";
import { CommitmentsList, commitmentsPaid } from "./commitment-list";

// Bills on This Month (#47): the month's Commitments, paid or due, and what's coming up in the
// next 30 days were two lists of the same bills one after the other. Now one section switches
// between them. An ended month has only its own.

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
	const shown = current ? view : "month";
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
			{current ? (
				<>
					<BillsSwitch view={view} onChange={setView} />
					<div
						role="tabpanel"
						id={`bills-${shown}`}
						aria-labelledby={`bills-tab-${shown}`}
						className="grid gap-3"
					>
						{shown === "month" ? (
							<CommitmentsList
								month={month}
								asOf={asOf}
								commitments={commitments}
								notDue={notDue}
							/>
						) : (
							<ComingUpList />
						)}
					</div>
				</>
			) : (
				<CommitmentsList month={month} asOf={asOf} commitments={commitments} notDue={notDue} />
			)}
		</Section>
	);
}

/** "This month · Coming up": a two-tab switch, by arrow keys too (APG Tabs). */
function BillsSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
	const { dues } = useComingUp();
	const tabs = useRef<Record<View, HTMLButtonElement | null>>({ month: null, "coming-up": null });
	const options: { value: View; label: string }[] = [
		{ value: "month", label: "This month" },
		{ value: "coming-up", label: `Coming up${dues.length > 0 ? ` (${dues.length})` : ""}` },
	];
	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const next = view === "month" ? "coming-up" : "month";
		onChange(next);
		tabs.current[next]?.focus();
	}
	return (
		<div
			role="tablist"
			aria-label="Bills"
			className="grid w-fit grid-flow-col gap-1 rounded-xl bg-surface-2 p-1"
			onKeyDown={onKeyDown}
		>
			{options.map((option) => {
				const selected = option.value === view;
				return (
					<button
						key={option.value}
						ref={(node) => {
							tabs.current[option.value] = node;
						}}
						type="button"
						role="tab"
						id={`bills-tab-${option.value}`}
						aria-selected={selected}
						aria-controls={`bills-${option.value}`}
						tabIndex={selected ? 0 : -1}
						onClick={() => onChange(option.value)}
						className={cn(
							"h-8 rounded-lg px-3 text-sm font-medium text-muted-foreground",
							"transition-colors duration-(--duration-fast) ease-standard hover:text-foreground",
							"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
							selected && "bg-card text-foreground shadow-card",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
