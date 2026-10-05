import {
	type Cents,
	freeToSpendAfterLowering,
	type LowerTakeHomePay,
	lowerTakeHomePayChange,
	type MonthKey,
	type TakeHomePayJust,
	undoLowerTakeHomePay,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { formatMoney, monthName } from "../format";
import { usePlanChange, withTakeHomePay } from "../plan-changes";
import { setTakeHomePay } from "../server/plan";

/**
 * A low month (#86, ADR-0040): lowers this month's take-home pay to the Income that came in, for
 * this month only, and offers Undo. Call it from a component that stays on screen once the step
 * is taken (the note itself goes), so the toast still shows.
 */
export function useLowerTakeHomePay(month: MonthKey) {
	const change = usePlanChange(month, {
		save: (data: TakeHomePayJust) => setTakeHomePay({ data }),
		apply: withTakeHomePay,
	});
	const name = monthName(month);

	function undo(step: LowerTakeHomePay) {
		change.mutate(undoLowerTakeHomePay(month, step), {
			onSuccess: () =>
				toast(`${name}’s take-home pay is back to ${formatMoney(step.was)}`, { tone: "success" }),
			onError: () =>
				toast(`Couldn’t undo that, so ${name}’s take-home pay is still ${formatMoney(step.to)}.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => undo(step) },
				}),
		});
	}

	function lower(step: LowerTakeHomePay, freeToSpend: Cents) {
		const after = freeToSpendAfterLowering(freeToSpend, step);
		change.mutate(lowerTakeHomePayChange(month, step), {
			onSuccess: () =>
				toast(
					`${name}’s take-home pay is now ${formatMoney(step.to)}. Free to Spend is ${formatMoney(after)}.`,
					{ tone: "success", undo: () => undo(step) },
				),
			onError: () =>
				toast(`Couldn’t lower ${name}’s take-home pay, so it’s still ${formatMoney(step.was)}.`, {
					tone: "error",
				}),
		});
	}

	return { lower, pending: change.isPending };
}

/**
 * The step, said plainly, with what Free to Spend becomes. `quiet` is Plan › Income's wording,
 * where it is always there in a low month; without it, This Month's, in the month's last days.
 */
export function LowerTakeHomePayNote({
	month,
	step,
	freeToSpend,
	quiet = false,
	pending,
	onLower,
	className,
}: {
	month: MonthKey;
	step: LowerTakeHomePay;
	/** The month's Free to Spend as it stands. */
	freeToSpend: Cents;
	quiet?: boolean;
	pending: boolean;
	onLower: () => void;
	className?: string;
}) {
	const hydrated = useHydrated();
	const name = monthName(month);
	const after = freeToSpendAfterLowering(freeToSpend, step);
	return (
		<div role="note" className={cn("grid gap-2 text-sm", className)}>
			<p>
				{quiet
					? `Came in lower this month? ${formatMoney(step.to)} has arrived so far.`
					: `${formatMoney(step.to)} of ${name}’s ${formatMoney(step.was)} take-home pay has come in.`}{" "}
				Set {name}’s take-home pay to what arrived and Free to Spend becomes {formatMoney(after)}
				{after < 0 ? ", so the Plan will need trimming" : ""}. Later months don’t change.
			</p>
			<Button
				type="button"
				variant="outline"
				size="wrap"
				className="justify-self-start"
				disabled={!hydrated || pending}
				onClick={onLower}
			>
				Lower take-home pay to {formatMoney(step.to)}
			</Button>
		</div>
	);
}
