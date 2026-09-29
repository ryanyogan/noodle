import {
	describeLever,
	type Lever,
	type LeverImpact,
	type LeverSubjects,
	leverImpacts,
	type PlanAhead,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { Eye, EyeOff, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { formatMoney, shortMonth } from "../format";
import { leverTarget, withMuted, withoutLever } from "../scenarios";

// "Your changes": each Lever in words, what it does on its own, a mute toggle to see the outcome
// without it, and Remove. Impacts cost one projection per Lever, so they follow the Levers a
// moment behind rather than on every slider step.

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}

export const ScenarioChanges = memo(function ScenarioChanges({
	ahead,
	levers,
	subjects,
	goalNames,
	horizonLabel,
	onChange,
}: {
	ahead: PlanAhead;
	levers: Lever[];
	subjects: LeverSubjects;
	/** Every Goal a Lever can move, Plan's and added, by id. */
	goalNames: ReadonlyMap<string, string>;
	horizonLabel: string;
	onChange: (change: (levers: Lever[]) => Lever[]) => void;
}) {
	const settled = useDebounced(levers, 250);
	const impacts = useMemo(() => {
		const all = leverImpacts(ahead, settled);
		return new Map(settled.map((lever, i) => [leverTarget(lever), all[i] as LeverImpact]));
	}, [ahead, settled]);

	return (
		<Section aria-labelledby="your-changes">
			<SectionHeader id="your-changes" title="Your changes" count={levers.length || undefined} />
			{levers.length === 0 ? (
				<p className="rounded-xl border border-dashed px-(--card-pad) py-4 text-[13px] text-muted-foreground">
					Nothing changed yet. Edit a line below and it shows up here, with what it does on its own.
				</p>
			) : (
				<Card>
					<List>
						{levers.map((lever) => {
							const target = leverTarget(lever);
							const { text, gone } = describeLever(lever, subjects, levers);
							return (
								<Change
									key={target}
									text={text}
									gone={gone}
									muted={lever.muted === true}
									impact={gone ? null : impacts.get(target)}
									goalNames={goalNames}
									horizonLabel={horizonLabel}
									onMute={(muted) => onChange((current) => withMuted(current, target, muted))}
									onRemove={() => onChange((current) => withoutLever(current, target))}
								/>
							);
						})}
					</List>
				</Card>
			)}
		</Section>
	);
});

function Change({
	text,
	gone,
	muted,
	impact,
	goalNames,
	horizonLabel,
	onMute,
	onRemove,
}: {
	text: string;
	gone: boolean;
	muted: boolean;
	/** Undefined while it's being worked out; null when it changes nothing. */
	impact: LeverImpact | null | undefined;
	goalNames: ReadonlyMap<string, string>;
	horizonLabel: string;
	onMute: (muted: boolean) => void;
	onRemove: () => void;
}) {
	return (
		<li
			aria-label={text}
			className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-(--card-pad) py-3"
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
			<div className="-me-1.5 flex items-center">
				{gone ? null : (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-pressed={muted}
						title={muted ? "Count it again" : "Leave it out"}
						className="text-muted-foreground aria-pressed:text-foreground"
						onClick={() => onMute(!muted)}
					>
						{muted ? <EyeOff /> : <Eye />}
						<span className="sr-only">Mute</span>
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					title="Remove"
					className="text-muted-foreground"
					onClick={onRemove}
				>
					<X />
					<span className="sr-only">Remove</span>
				</Button>
			</div>
		</li>
	);
}

/**
 * What a Lever does on its own, e.g. "Frees $16,800 over 2 years · College 4 months sooner". A
 * muted one says what it would do.
 */
function impactWords(
	impact: LeverImpact | null,
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
				? `${says("add", impact.cushion)} to the Cushion`
				: `${says("take", impact.cushion)} from the Cushion`,
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
