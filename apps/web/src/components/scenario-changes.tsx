import {
	describeChange,
	type ScenarioChange,
	type ScenarioChangeImpact,
	type ScenarioChangeSubjects,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Toggle } from "@noodle/ui/components/toggle";
import { WithTooltip } from "@noodle/ui/components/tooltip";
import { cn } from "@noodle/ui/lib/utils";
import { Eye, EyeOff, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { formatMoney, shortMonth } from "../format";
import { changeTarget, withMuted, withoutChange } from "../scenarios";

// "Your changes": each Change in words, what it does on its own, a mute toggle to see the outcome
// without it, and Remove. Impacts cost one projection per Change, so they follow the Changes a
// moment behind rather than on every slider step.

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}

export const ScenarioChanges = memo(function ScenarioChanges({
	impacts,
	levers,
	subjects,
	goalNames,
	horizonLabel,
	onChange,
}: {
	/** Each Change's impact by its target, a moment behind the Changes (see useDebounced). */
	impacts: ReadonlyMap<string, ScenarioChangeImpact>;
	levers: ScenarioChange[];
	subjects: ScenarioChangeSubjects;
	/** Every Goal a Change can move, Plan's and added, by id. */
	goalNames: ReadonlyMap<string, string>;
	horizonLabel: string;
	/** Left out where the Changes are only read (a kept Scenario's page): no Leave out or Remove. */
	onChange?: (change: (changes: ScenarioChange[]) => ScenarioChange[]) => void;
}) {
	return (
		<Section aria-labelledby="your-changes">
			<SectionHeader id="your-changes" title="Your changes" count={levers.length || undefined} />
			{levers.length === 0 ? (
				<p className="rounded-xl border border-dashed px-(--card-pad) py-4 text-[13px] text-muted-foreground">
					{onChange
						? "Nothing changed yet. Edit a line below and it shows up here, with what it does on its own."
						: "This Scenario changes nothing."}
				</p>
			) : (
				<Card>
					<List>
						{levers.map((scenarioChange) => {
							const target = changeTarget(scenarioChange);
							const { text, gone } = describeChange(scenarioChange, subjects, levers);
							return (
								<Change
									key={target}
									id={changeId(target)}
									text={text}
									gone={gone}
									muted={scenarioChange.muted === true}
									impact={gone ? null : impacts.get(target)}
									goalNames={goalNames}
									horizonLabel={horizonLabel}
									onMute={
										onChange &&
										((muted) => onChange((current) => withMuted(current, target, muted)))
									}
									onRemove={
										onChange && (() => onChange((current) => withoutChange(current, target)))
									}
								/>
							);
						})}
					</List>
				</Card>
			)}
		</Section>
	);
});

/** The id of a change in the list, for a warning to link to. */
export const changeId = (target: string) => `change-${target}`;

function Change({
	id,
	text,
	gone,
	muted,
	impact,
	goalNames,
	horizonLabel,
	onMute,
	onRemove,
}: {
	id: string;
	text: string;
	gone: boolean;
	muted: boolean;
	/** Undefined while it's being worked out; null when it changes nothing. */
	impact: ScenarioChangeImpact | null | undefined;
	goalNames: ReadonlyMap<string, string>;
	horizonLabel: string;
	onMute?: (muted: boolean) => void;
	onRemove?: () => void;
}) {
	return (
		<li
			id={id}
			aria-label={text}
			// A warning's link lands here: focused, and briefly shaded.
			tabIndex={-1}
			className="grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-(--card-pad) py-3 outline-none transition-colors duration-700 focus:bg-surface-2"
		>
			<div className="grid min-w-0 gap-0.5">
				<p
					className={cn(
						"text-sm font-medium",
						(muted || gone) && "text-muted-foreground",
						gone && "line-through decoration-muted-foreground/60",
					)}
				>
					{text}
				</p>
				{gone ? (
					<div>
						<Badge variant="over">No longer in the Plan</Badge>
					</div>
				) : (
					<p className="text-[13px] text-muted-foreground tabular-nums">
						{impact === undefined
							? " "
							: impactWords(impact, muted, horizonLabel, goalNames) || "No change on its own"}
					</p>
				)}
			</div>
			{onMute || onRemove ? (
				<div className="-me-1.5 flex items-center">
					{gone || !onMute ? null : (
						<WithTooltip label={muted ? "Left out: count it again" : "Leave it out"}>
							<Toggle
								size="sm"
								aria-label="Leave out"
								pressed={muted}
								onPressedChange={onMute}
								className="text-muted-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground"
							>
								{muted ? <EyeOff /> : <Eye />}
							</Toggle>
						</WithTooltip>
					)}
					{onRemove ? (
						<WithTooltip label="Remove">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Remove"
								className="text-muted-foreground"
								onClick={onRemove}
							>
								<X />
							</Button>
						</WithTooltip>
					) : null}
				</div>
			) : muted ? (
				<Badge variant="count">Left out</Badge>
			) : null}
		</li>
	);
}

/**
 * What a Change does on its own, e.g. "Frees $16,800 over 2 years · College 4 months sooner". A
 * muted one says what it would do.
 */
function impactWords(
	impact: ScenarioChangeImpact | null,
	muted: boolean,
	horizonLabel: string,
	goalNames: ReadonlyMap<string, string>,
) {
	if (!impact) return "";
	const parts: string[] = [];
	// "Frees $1,200" or, muted, "Would free $1,200".
	const says = (verb: string, amount: number) =>
		`${muted ? `Would ${verb}` : `${verb[0]?.toUpperCase()}${verb.slice(1)}s`} ${formatMoney(Math.abs(amount))}`;
	if (impact.freeToSpend !== 0) {
		parts.push(
			`${says(impact.freeToSpend > 0 ? "free" : "cost", impact.freeToSpend)} over ${horizonLabel}`,
		);
	} else if (impact.cushion !== 0) {
		parts.push(
			impact.cushion > 0
				? `${says("add", impact.cushion)} to the projected balance`
				: `${says("take", impact.cushion)} from the projected balance`,
		);
	}
	for (const goal of impact.goals) {
		const name = goalNames.get(goal.goalId) ?? "A Goal";
		if (goal.months !== null) {
			if (goal.months !== 0) {
				const n = Math.abs(goal.months);
				parts.push(
					`${name} ${n} month${n === 1 ? "" : "s"} ${goal.months > 0 ? "later" : "sooner"}`,
				);
			}
		} else if (goal.reachedIn !== goal.without) {
			parts.push(
				goal.reachedIn ? `${name} reached ${shortMonth(goal.reachedIn)}` : `${name} not reached`,
			);
		}
	}
	return parts.join(" · ");
}
