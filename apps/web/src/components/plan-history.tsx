import type { Cents, MonthKey, PlanChange, PlanChangeValue } from "@noodle/domain";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { List } from "@noodle/ui/components/list";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cadenceNames } from "../commitments";
import { formatMoney, fullDay, monthName, shortDay } from "../format";
import { planHistoryQuery } from "../queries";

// The Plan's history in words (ADR-0014): what a Plan change moved from and to, when it takes
// effect, who made it and when. An item's own History is drawn here; every change together is the
// Log in Household settings (household-log.tsx). The other Parent's Personal Allowance only ever reads as
// "Personal Allowance changed" (ADR-0003).

const PERSONAL_ALLOWANCE = "Personal Allowance changed";

const amountText = (amount: Cents | null | undefined) =>
	amount === null || amount === undefined ? "none" : formatMoney(amount);

const fromTo = <T,>(was: T | undefined, now: T, text: (value: T) => string) =>
	was === undefined ? text(now) : `${text(was)} → ${text(now)}`;

/**
 * The values that moved, in words: "$500 → $600", "Fresh start → carries over", "Renamed from
 * “Food”", "Every two weeks, due Oct 9", "Target $12,000 by Jun 30, 2027". Without `before`,
 * just what they are now.
 */
function describeValues(before: PlanChangeValue | null, after: PlanChangeValue): string[] {
	const was = before ?? {};
	const parts: string[] = [];
	if (was.name !== undefined && after.name !== undefined) parts.push(`Renamed from “${was.name}”`);
	if ("amount" in after) {
		// Nothing before (no take-home pay yet, say) reads as set, not "none → $9,000".
		parts.push(
			was.amount === null
				? `Set to ${amountText(after.amount)}`
				: fromTo(was.amount, after.amount, amountText),
		);
	}
	if (after.rolling !== undefined) {
		parts.push(fromTo(was.rolling, after.rolling, (r) => (r ? "Carries over" : "Resets monthly")));
	}
	if (after.cadence !== undefined) {
		parts.push(fromTo(was.cadence, after.cadence, (c) => cadenceNames[c]));
	}
	if (after.dueDate !== undefined) {
		parts.push(fromTo(was.dueDate, after.dueDate, (d) => `due ${shortDay(d)}`));
	}
	if (after.paysDown !== undefined) {
		// A Commitment's card or loan (ADR-0050).
		const from = was.paysDown ?? null;
		if (after.paysDown === null)
			parts.push(from ? `No longer pays down ${from}` : "Pays down nothing");
		else parts.push(from ? `Pays down ${from} → ${after.paysDown}` : `Pays down ${after.paysDown}`);
	}
	if (after.about !== undefined) {
		// A bill that varies (issue 135).
		parts.push(after.about ? "Now about: it varies" : "Now the same each time");
	}
	if (after.target !== undefined) {
		parts.push(`Target ${fromTo(was.target, after.target, formatMoney)}`);
	}
	if (after.targetDate !== undefined) {
		parts.push(
			fromTo(was.targetDate, after.targetDate, (d) =>
				d === null ? "no date" : `by ${fullDay(d)}`,
			),
		);
	}
	return parts;
}

/** One Plan change in words, for an item's history. */
export function describeChange(change: PlanChange): string {
	switch (change.kind) {
		case "personal-allowance":
			return PERSONAL_ALLOWANCE;
		case "bucket-archive":
			return "Archived";
		case "bucket-restore":
			return ["Back in the Plan", ...describeValues(null, change.after ?? {})].join(" · ");
		case "commitment-end":
			return "Ended";
		case "bucket-add":
		case "commitment-add":
		case "goal-add":
			return ["Added", ...describeValues(null, { ...change.after, name: undefined })].join(" · ");
		default:
			return describeValues(change.before, change.after ?? {}).join(" · ") || "Changed";
	}
}

/** "Just October", "From October on", or "From October until December". */
export function scopeText(change: Pick<PlanChange, "month" | "scope" | "after">): string {
	if (change.scope === "just") return `Just ${monthName(change.month)}`;
	const until = change.after?.until;
	return until
		? `From ${monthName(change.month)} until ${monthName(until)}`
		: `From ${monthName(change.month)} on`;
}

/** "from “Tighter groceries”" for a change applied from a Scenario, else null. */
export const fromScenario = (change: Pick<PlanChange, "source" | "scenarioName">) =>
	change.source !== "scenario"
		? null
		: change.scenarioName === null
			? "from a Scenario"
			: `from “${change.scenarioName}”`;

/** "History starts Sep 30": no Plan changes were kept before the first one logged. */
function HistoryStart({ day }: { day: string | null }) {
	return (
		<p className="text-[13px] text-muted-foreground">
			{day === null ? "No Plan changes yet." : `History starts ${fullDay(day)}.`}
		</p>
	);
}

/**
 * Every Plan change to one Bucket or Commitment, newest first: what changed, from when, who and
 * on what day. Fetched when shown, e.g. when its History disclosure opens.
 */
export function PlanHistoryList({ month, targetId }: { month: MonthKey; targetId: string }) {
	const history = useQuery(planHistoryQuery(month, targetId));
	if (history.isPending) {
		return <p className="text-[13px] text-muted-foreground">Loading history…</p>;
	}
	if (history.isError) {
		return <p className="text-[13px] text-muted-foreground">Couldn’t load the history.</p>;
	}
	const { changes, historyStart } = history.data;
	// When history starts matters only when the list is empty or cut short: its oldest change
	// edits something that was already there before the log began.
	const cutShort = changes.length === 0 || changes[changes.length - 1]?.before !== null;
	return (
		<div className="grid gap-2">
			{changes.length > 0 ? (
				<List>
					{changes.map((change) => (
						<li key={change.id} className="grid gap-0.5 px-(--card-pad) py-3">
							<p className="text-sm">{describeChange(change)}</p>
							<p className="text-[13px] text-muted-foreground">
								{scopeText(change)} · {change.memberName} · {shortDay(change.day)}
								{change.source === "scenario" ? ` · ${fromScenario(change)}` : ""}
							</p>
						</li>
					))}
				</List>
			) : null}
			{cutShort ? <HistoryStart day={historyStart} /> : null}
		</div>
	);
}

/** A closed "History" disclosure in an edit sheet; the history loads when it opens. */
export function PlanHistoryDisclosure({ month, targetId }: { month: MonthKey; targetId: string }) {
	return (
		<Collapsible className="group mt-2 border-t pt-4">
			<CollapsibleTrigger className="flex min-h-11 w-full items-center gap-1.5 text-start text-sm font-medium lg:min-h-8">
				<ChevronRight
					className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
					aria-hidden="true"
				/>
				History
			</CollapsibleTrigger>
			{/* Mounted only while open, so the history loads when it opens. */}
			<CollapsibleContent className="mt-3">
				<PlanHistoryList month={month} targetId={targetId} />
			</CollapsibleContent>
		</Collapsible>
	);
}
