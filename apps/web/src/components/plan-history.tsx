import type { Cents, MonthKey, PlanChange, PlanChangeGroup, PlanChangeValue } from "@noodle/domain";
import { List } from "@noodle/ui/components/list";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cadenceNames } from "../commitments";
import { formatMoney, fullDay, monthName, shortDay } from "../format";
import { planHistoryQuery } from "../queries";
import type { DatedPlanChange } from "../server/plan";

// The Plan's history in words (ADR-0014): what a Plan change moved from and to, when it takes
// effect, who made it and when. The other Parent's Personal Allowance only ever reads as
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
export function describeValues(before: PlanChangeValue | null, after: PlanChangeValue): string[] {
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

/** One item's net change over a month, in words. */
export function describeGroup(group: PlanChangeGroup): string {
	if (group.kind === "personal-allowance") return PERSONAL_ALLOWANCE;
	if (group.removed) return group.kind === "commitment" ? "Ended" : "Archived";
	if (group.restored) {
		return ["Back in the Plan", ...describeValues(null, { ...group.after, name: undefined })].join(
			" · ",
		);
	}
	if (group.added) {
		return ["Added", ...describeValues(null, { ...group.after, name: undefined })].join(" · ");
	}
	return describeValues(group.before, group.after).join(" · ");
}

/** "Just October", "From October on", or "From October until December". */
export function scopeText(change: Pick<PlanChange, "month" | "scope" | "after">): string {
	if (change.scope === "just") return `Just ${monthName(change.month)}`;
	const until = change.after?.until;
	return until
		? `From ${monthName(change.month)} until ${monthName(until)}`
		: `From ${monthName(change.month)} on`;
}

/** What a group or change is about: the Bucket, Commitment or Goal, or take-home pay. */
export const groupTitle = (group: Pick<PlanChangeGroup, "kind" | "targetName">) =>
	group.kind === "baseline"
		? "Take-home pay"
		: group.kind === "personal-allowance"
			? PERSONAL_ALLOWANCE
			: (group.targetName ?? "Removed item");

const people = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** "from “Tighter groceries”" for a change applied from a Scenario, else null. */
const fromScenario = (change: Pick<PlanChange, "source" | "scenarioName">) =>
	change.source !== "scenario"
		? null
		: change.scenarioName === null
			? "from a Scenario"
			: `from “${change.scenarioName}”`;

/** "Alex and Sam · Oct 2 · from “Tighter groceries”": who made a group's changes, and when last. */
export function groupMeta(group: PlanChangeGroup<DatedPlanChange>): string {
	const names = people.format([...new Set(group.changes.map((c) => c.memberName))]);
	const latest = group.changes[0];
	const scenario = group.changes.map(fromScenario).find((s) => s !== null);
	return `${names}${latest ? ` · ${shortDay(latest.day)}` : ""}${scenario ? ` · ${scenario}` : ""}`;
}

/** "History starts Sep 30": no Plan changes were kept before the first one logged. */
export function HistoryStart({ day }: { day: string | null }) {
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
			<HistoryStart day={historyStart} />
		</div>
	);
}

/** A closed "History" disclosure in an edit sheet; the history loads when it opens. */
export function PlanHistoryDisclosure({ month, targetId }: { month: MonthKey; targetId: string }) {
	const [open, setOpen] = useState(false);
	return (
		<details
			className="group mt-2 border-t pt-4"
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
				<ChevronRight
					className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
					aria-hidden="true"
				/>
				History
			</summary>
			{open ? (
				<div className="mt-3">
					<PlanHistoryList month={month} targetId={targetId} />
				</div>
			) : null}
		</details>
	);
}
