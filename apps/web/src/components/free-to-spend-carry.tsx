import { addMonths, type MonthKey, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Field, FormError } from "@noodle/ui/components/field";
import { RadioGroup, RadioGroupCard } from "@noodle/ui/components/radio-group";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { useHydrated } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import { useFreeCarry, usePlanChange, withFreeBuildsUp, withFreeKeepBack } from "../plan-changes";
import { setFreeToSpendBuildsUp, setFreeToSpendKeepBack } from "../server/free-to-spend";
import { AmountInput } from "./goals";
import { SaveFailed } from "./plan-editing";

// What happens to Free to Spend at the end of the month (issue 113, ADR-0054): it starts fresh
// (the default) or builds up into the next month. One quiet line at the foot of the Plan's split,
// with a sheet to change it, offered the way a Bucket's "At the end of the month" is.

const OPTIONS = [
	{
		value: "starts-fresh",
		label: "Starts fresh",
		description: "Each month’s Free to Spend is worked out from that month alone.",
	},
	{
		value: "builds-up",
		label: "Builds up",
		description:
			"What’s left is carried over into next month’s Free to Spend. A month that ends below zero carries nothing.",
	},
] as const;

export function FreeToSpendCarry({
	month,
	editable,
	carriedIn,
}: {
	month: MonthKey;
	editable: boolean;
	/** What last month carried into this one. */
	carriedIn: number;
}) {
	const { buildsUp, keepBack } = useFreeCarry(month);
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	return (
		<div
			data-slot="free-to-spend-carry"
			className="flex items-center justify-between gap-3 border-t px-(--card-pad) py-1.5 text-[13px] text-muted-foreground"
		>
			<p className="min-w-0 py-1">
				At the end of the month, Free to Spend{" "}
				<span className="font-medium text-foreground">
					{buildsUp ? "builds up" : "starts fresh"}
				</span>
				{keepBack > 0 ? ` · ${formatMoney(keepBack)} kept back` : null}
			</p>
			{editable ? (
				<>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="-me-2 min-h-9 shrink-0"
						aria-label="Change what Free to Spend does at the end of the month"
						disabled={!hydrated}
						onClick={() => setOpen(true)}
					>
						Change
					</Button>
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetContent>
							<SheetHeader title="Free to Spend" description="At the end of the month" />
							{open ? (
								<CarryForm
									month={month}
									buildsUp={buildsUp}
									keepBack={keepBack}
									carriedIn={carriedIn}
									onDone={() => setOpen(false)}
								/>
							) : null}
						</SheetContent>
					</Sheet>
				</>
			) : null}
		</div>
	);
}

function CarryForm({
	month,
	buildsUp,
	keepBack,
	carriedIn,
	onDone,
}: {
	month: MonthKey;
	buildsUp: boolean;
	keepBack: number;
	carriedIn: number;
	onDone: () => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const [choice, setChoice] = useState(buildsUp);
	const [keep, setKeep] = useState(keepBack > 0 ? formatMoneyInput(keepBack) : "");
	const keepCents = keep.trim() === "" ? 0 : parseDollars(keep);
	const carry = usePlanChange(month, {
		save: (data: { month: MonthKey; buildsUp: boolean }) => setFreeToSpendBuildsUp({ data }),
		apply: withFreeBuildsUp,
	});
	const kept = usePlanChange(month, {
		save: (data: { amountCents: number }) => setFreeToSpendKeepBack({ data }),
		apply: withFreeKeepBack,
	});
	const dirty = choice !== buildsUp || (keepCents !== null && keepCents !== keepBack);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (keepCents === null) return;
		if (choice !== buildsUp) carry.mutate({ month, buildsUp: choice });
		if (keepCents !== keepBack) kept.mutate({ amountCents: keepCents });
		onDone();
	}

	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<div className="grid gap-2">
				<p id={`${id}-label`} className="mb-2 text-sm font-medium">
					What’s left in Free to Spend
				</p>
				<RadioGroup
					aria-labelledby={`${id}-label`}
					value={choice ? "builds-up" : "starts-fresh"}
					onValueChange={(value) => setChoice(value === "builds-up")}
				>
					{OPTIONS.map((option) => (
						<RadioGroupCard
							key={option.value}
							id={`${id}-${option.value}`}
							value={option.value}
							label={option.label}
							description={option.description}
							className="border-transparent bg-surface-2 has-data-[state=checked]:bg-surface-2"
						/>
					))}
				</RadioGroup>
				{choice !== buildsUp ? (
					<p className="text-xs text-subtle-foreground">
						{choice
							? `From ${monthName(month)} on: what ${monthName(month)} ends with is carried over into ${monthName(addMonths(month, 1))}. Earlier months aren’t pulled in.`
							: carriedIn > 0
								? `From ${monthName(month)} on. The ${formatMoney(carriedIn)} built up so far stays in ${monthName(month)}’s Free to Spend and ends with it.`
								: `From ${monthName(month)} on.`}
					</p>
				) : null}
			</div>
			<Field label="Keep back" htmlFor={`${id}-keep`}>
				<AmountInput
					id={`${id}-keep`}
					placeholder="0"
					value={keep}
					aria-invalid={keepCents === null || undefined}
					aria-describedby={`${id}-keep-hint`}
					onChange={(event) => setKeep(event.currentTarget.value)}
				/>
			</Field>
			<p id={`${id}-keep-hint`} className="-mt-2 text-xs text-subtle-foreground">
				When a month is closed, this much stays in Free to Spend rather than being offered to a
				Goal.
			</p>
			{keepCents === null ? (
				<FormError>Enter the amount as dollars, like 100 or 85.50.</FormError>
			) : null}
			<SaveFailed change={carry} />
			<SheetFooter className="max-lg:grid-cols-2">
				<Button type="button" variant="outline" onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" disabled={!hydrated || !dirty || keepCents === null}>
					Save
				</Button>
			</SheetFooter>
		</form>
	);
}
