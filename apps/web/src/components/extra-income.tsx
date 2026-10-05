import type { IncomeRecord } from "@noodle/db";
import {
	type BucketState,
	type Cents,
	type DayKey,
	type ExtraIncomeDestination,
	type ExtraIncomeSuggestion,
	type MonthKey,
	monthOfDay,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Combobox } from "@noodle/ui/components/combobox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { Field } from "@noodle/ui/components/field";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { Ellipsis, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { useIncome } from "../extra-income";
import { formatMoney, formatMoneyInput, shortDay } from "../format";
import type { GoalView } from "../goals";
import { AmountInput, AmountSheet } from "./goals";
import { TermHelp } from "./term-help";

/**
 * A month's income, with adding and removing it: the one income list This Month and Plan › Income
 * both show, with the same Add income sheet and row actions. Only this month takes new income.
 */
export function MonthIncome({
	month,
	asOf,
	baseline,
	income,
}: {
	month: MonthKey;
	/** Today: income is recorded on it, so only this month takes it. */
	asOf: DayKey;
	baseline: Cents;
	/** This month's income. */
	income: IncomeRecord[];
}) {
	const [adding, setAdding] = useState(false);
	const writes = useIncome();
	return (
		<>
			<IncomeSection
				baseline={baseline}
				income={income}
				canRecord={monthOfDay(asOf) === month}
				onAdd={() => setAdding(true)}
				onRemove={(entry) =>
					writes.remove.mutate({
						incomeId: entry.id,
						month,
						date: entry.date,
						amountCents: entry.amount,
						note: entry.note,
					})
				}
			/>
			<AmountSheet
				open={adding}
				onOpenChange={setAdding}
				title="Add income"
				description="Money in today: a paycheck, a bonus, a tax refund. A Refund of a purchase goes back to its Bucket instead."
				withNote
				notePlaceholder="e.g. Paycheck"
				submitLabel="Add income"
				check={() => ({
					hint: "Whatever comes in above your usual take-home pay is Extra income, for you to decide where it goes.",
				})}
				onSave={(amountCents, note) => {
					setAdding(false);
					writes.record.mutate({ incomeId: ulid(), month, date: asOf, amountCents, note });
				}}
			/>
		</>
	);
}

/** The month's income against the Take-home pay: what came in, and each entry (removable this month). */
export function IncomeSection({
	baseline,
	income,
	canRecord,
	onAdd,
	onRemove,
}: {
	baseline: Cents;
	/** This month's income. */
	income: IncomeRecord[];
	/** Income is recorded today, so only this month takes it. */
	canRecord: boolean;
	onAdd: () => void;
	onRemove: (income: IncomeRecord) => void;
}) {
	const hydrated = useHydrated();
	const received = income.reduce((sum, i) => sum + i.amount, 0);
	return (
		<Section aria-labelledby="income">
			<SectionHeader
				id="income"
				title="Income"
				action={
					canRecord ? (
						<Button variant="outline" size="sm" disabled={!hydrated} onClick={onAdd}>
							Add income
						</Button>
					) : null
				}
			/>
			<p className="px-1 pb-2 text-sm text-muted-foreground">
				<span className="font-medium text-foreground tabular-nums">{formatMoney(received)}</span>{" "}
				received of {formatMoney(baseline)} usual take-home pay
			</p>
			{income.length > 0 ? (
				<List>
					{income.map((entry) => (
						<ListRow
							key={entry.id}
							title={entry.note ?? "Income"}
							meta={shortDay(entry.date)}
							trailing={
								<div className="flex items-center gap-1">
									<span className="tabular-nums">{formatMoney(entry.amount)}</span>
									{canRecord ? (
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													disabled={!hydrated}
													aria-label={`Actions for ${formatMoney(entry.amount)} of income`}
												>
													<Ellipsis className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent>
												<DropdownMenuItem variant="destructive" onSelect={() => onRemove(entry)}>
													<Trash2 />
													Remove income
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									) : null}
								</div>
							}
						/>
					))}
				</List>
			) : null}
		</Section>
	);
}

const reasonText = (suggestion: ExtraIncomeSuggestion, goals: GoalView[]) => {
	if (suggestion.reason === "overspent") return "Overspent this month";
	if (suggestion.reason === "emergency") return "Your emergency Goal";
	const goal = goals.find((g) => suggestion.to.kind === "goal" && g.id === suggestion.to.goalId);
	return goal?.targetDate
		? `Behind schedule · due ${shortDay(goal.targetDate)} ${goal.targetDate.slice(0, 4)}`
		: "Behind schedule";
};

/**
 * A month's Extra income awaiting a decision: a few suggested places for it (deterministic rules,
 * see extraIncomeSuggestions), each sent with one tap, or somewhere else of the Parent's choosing.
 */
export function ExtraIncomeSection({
	left,
	suggestions,
	goals,
	onSend,
	onChoose,
	onAddToFree,
	monthName,
}: {
	/** The Extra income still to decide. */
	left: Cents;
	/** Adds all that's left to the month's Free to Spend, in one tap. */
	onAddToFree: () => void;
	/** The month it came in, so it isn't mistaken for the last month's, decided at its Close. */
	monthName?: string;
	suggestions: ExtraIncomeSuggestion[];
	goals: GoalView[];
	onSend: (suggestion: ExtraIncomeSuggestion) => void;
	onChoose: () => void;
}) {
	const hydrated = useHydrated();
	return (
		<Section aria-labelledby="extra-income">
			{/* From lg this sits in a To do row that already says "Extra income" and holds its help,
			    so the heading is only for screen readers and "Choose where" follows the text (#73). */}
			<div className="lg:sr-only">
				<SectionHeader
					id="extra-income"
					title="Extra income"
					help={
						<span className="lg:hidden">
							<TermHelp term="extra-income" />
						</span>
					}
					action={
						<Button
							variant="outline"
							size="sm"
							className="lg:hidden"
							disabled={!hydrated}
							onClick={onChoose}
						>
							Choose where
						</Button>
					}
				/>
			</div>
			<p className="px-1 pb-3 text-sm text-muted-foreground">
				<span className="font-medium text-foreground tabular-nums">{formatMoney(left)}</span> came
				in above your usual take-home pay{monthName ? ` in ${monthName}` : ""}. Add it to Free to
				Spend to use it, or choose a Goal or Bucket for it.
			</p>
			<div className="flex flex-wrap gap-2 px-1 pb-3">
				<Button
					size="sm"
					disabled={!hydrated}
					aria-label={`Add ${formatMoney(left)} to Free to Spend`}
					onClick={onAddToFree}
				>
					Add to Free to Spend
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="max-lg:hidden"
					disabled={!hydrated}
					onClick={onChoose}
				>
					Choose where
				</Button>
			</div>
			{suggestions.length > 0 ? (
				<List aria-label="Suggestions">
					{suggestions.slice(0, 3).map((s) => (
						<ListRow
							key={destinationValue(s.to)}
							title={s.name}
							meta={reasonText(s, goals)}
							trailing={
								<Button
									variant="outline"
									size="sm"
									disabled={!hydrated}
									aria-label={`Send ${formatMoney(s.amount)} to ${s.name}`}
									onClick={() => onSend(s)}
								>
									Send {formatMoney(s.amount)}
								</Button>
							}
						/>
					))}
				</List>
			) : null}
		</Section>
	);
}

/** Where Extra income can go: the active Goals, and (this month) the Buckets the Parent can use. */
export type ExtraIncomePlaces = {
	goals: Pick<GoalView, "id" | "name">[];
	buckets: Pick<BucketState, "id" | "name">[];
};

const FREE_TO_SPEND = "free-to-spend";

const destinationValue = (to: ExtraIncomeDestination) =>
	to.kind === "goal"
		? `goal:${to.goalId}`
		: to.kind === "bucket"
			? `bucket:${to.bucketId}`
			: FREE_TO_SPEND;

/** Sends some of the Extra income to Free to Spend, or a Goal or Bucket the Parent picks. */
export function ExtraIncomeSheet({
	open,
	onOpenChange,
	left,
	places,
	onSend,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	left: Cents;
	places: ExtraIncomePlaces;
	onSend: (to: ExtraIncomeDestination, name: string, amountCents: Cents) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader
						title="Send the Extra income"
						description="Add it to Free to Spend to use this month, set it aside for a Goal, or add it to a Bucket."
					/>
					<ExtraIncomeForm left={left} places={places} onSend={onSend} />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function ExtraIncomeForm({
	left,
	places,
	onSend,
}: {
	left: Cents;
	places: ExtraIncomePlaces;
	onSend: (to: ExtraIncomeDestination, name: string, amountCents: Cents) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const first = places.goals[0]
		? destinationValue({ kind: "goal", goalId: places.goals[0].id })
		: places.buckets[0]
			? destinationValue({ kind: "bucket", bucketId: places.buckets[0].id })
			: FREE_TO_SPEND;
	const [destination, setDestination] = useState(first);
	const [amount, setAmount] = useState(() => formatMoneyInput(left));
	const cents = parseDollars(amount);
	const tooMuch = cents !== null && cents > left;
	const valid = cents !== null && cents > 0 && !tooMuch && destination !== "";

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!valid || cents === null) return;
		if (destination === FREE_TO_SPEND) {
			onSend({ kind: "free-to-spend" }, "Free to Spend", cents);
			return;
		}
		const [kind, placeId = ""] = destination.split(":");
		const place =
			kind === "goal"
				? places.goals.find((g) => g.id === placeId)
				: places.buckets.find((b) => b.id === placeId);
		if (!place) return;
		onSend(
			kind === "goal" ? { kind: "goal", goalId: placeId } : { kind: "bucket", bucketId: placeId },
			place.name,
			cents,
		);
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field label="To" htmlFor={`${id}-to`}>
				<Combobox
					id={`${id}-to`}
					value={destination}
					disabled={!hydrated}
					onValueChange={setDestination}
					searchPlaceholder="Find a Goal or Bucket"
					choices={[
						{
							label: "This month",
							choices: [{ value: FREE_TO_SPEND, label: "Free to Spend" }],
						},
						...(places.goals.length > 0
							? [
									{
										label: "Goals",
										choices: places.goals.map((g) => ({
											value: destinationValue({ kind: "goal", goalId: g.id }),
											label: g.name,
										})),
									},
								]
							: []),
						...(places.buckets.length > 0
							? [
									{
										label: "Buckets",
										choices: places.buckets.map((b) => ({
											value: destinationValue({ kind: "bucket", bucketId: b.id }),
											label: b.name,
										})),
									},
								]
							: []),
					]}
				/>
			</Field>
			<Field
				label="Amount"
				htmlFor={`${id}-amount`}
				hint={
					<span className={cn(tooMuch && "text-over")}>
						{tooMuch
							? `Only ${formatMoney(left)} of the Extra income is left.`
							: `${formatMoney(left)} of the Extra income is left to decide.`}
					</span>
				}
			>
				<AmountInput
					id={`${id}-amount`}
					placeholder="0"
					enterKeyHint="done"
					value={amount}
					disabled={!hydrated}
					aria-invalid={(amount !== "" && !valid) || undefined}
					onChange={(event) => setAmount(event.currentTarget.value)}
				/>
			</Field>
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || !valid}>
					Send
				</Button>
			</SheetFooter>
		</form>
	);
}
