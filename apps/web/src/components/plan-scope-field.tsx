import { addMonths, type Cents, type MonthKey, type PlanScope, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Field } from "@noodle/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { useHydrated } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import { AmountInput } from "./goals";

/**
 * How far a change to an amount in the Plan reaches: from its month on (later months follow,
 * unless they have their own amount), or just that month (the next goes back to `current`).
 */
export function PlanScopeField({
	month,
	current,
	scope,
	onScopeChange,
}: {
	month: MonthKey;
	/** The amount before the change, which the next month goes back to after a "just" change. */
	current: Cents;
	scope: PlanScope;
	onScopeChange: (scope: PlanScope) => void;
}) {
	const hydrated = useHydrated();
	const options = [
		{ scope: "from-on", label: `From ${monthName(month)} on` },
		{ scope: "just", label: `Just ${monthName(month)}` },
	] as const;
	return (
		<div className="grid gap-2">
			<ToggleGroup
				type="single"
				variant="segmented"
				aria-label="Applies to"
				value={scope}
				disabled={!hydrated}
				onValueChange={(value) => onScopeChange(value as PlanScope)}
				className="grid w-full grid-cols-2"
			>
				{options.map((option) => (
					<ToggleGroupItem key={option.scope} value={option.scope} className="min-w-0">
						<span className="truncate">{option.label}</span>
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<p className="text-xs text-subtle-foreground">
				{scope === "just"
					? `${monthName(addMonths(month, 1))} goes back to ${formatMoney(current)}.`
					: "Later months follow, unless they have their own amount."}
			</p>
		</div>
	);
}

/**
 * An amount in the Plan (an allowance, take-home pay) and how far its change reaches, saved
 * together. Without `withScope` (nothing set yet) it applies from the month on.
 */
export function PlanAmountForm({
	month,
	label,
	value,
	withScope = true,
	submitLabel = "Save",
	onSave,
}: {
	month: MonthKey;
	label: string;
	value: Cents | null;
	withScope?: boolean;
	submitLabel?: string;
	onSave: (amountCents: Cents, scope: PlanScope) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [amount, setAmount] = useState(() => (value === null ? "" : formatMoneyInput(value)));
	const [scope, setScope] = useState<PlanScope>("from-on");
	const cents = parseDollars(amount);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (cents !== null) onSave(cents, withScope ? scope : "from-on");
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field label={label} htmlFor={`${id}-amount`}>
				<AmountInput
					id={`${id}-amount`}
					placeholder="0"
					enterKeyHint="done"
					value={amount}
					disabled={!hydrated}
					aria-invalid={(amount !== "" && cents === null) || undefined}
					onChange={(event) => setAmount(event.currentTarget.value)}
				/>
			</Field>
			{withScope && value !== null ? (
				<PlanScopeField month={month} current={value} scope={scope} onScopeChange={setScope} />
			) : null}
			<Button type="submit" disabled={!hydrated || cents === null}>
				{submitLabel}
			</Button>
		</form>
	);
}

/**
 * "Changed this month · was $X", in a row's meta beside an amount the month changed from the
 * month before; nothing when it didn't.
 */
export function ChangedNote({ was }: { was: Cents | undefined | null }) {
	if (was === undefined || was === null) return null;
	return (
		<>
			<span aria-hidden="true">·</span>
			<span>Changed this month · was {formatMoney(was)}</span>
		</>
	);
}
