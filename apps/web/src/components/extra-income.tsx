import type { BetweenUsIncome, IncomeRecord } from "@noodle/db";
import {
	type BucketState,
	type Cents,
	type DayKey,
	type ExtraIncomeDestination,
	type ExtraIncomeSuggestion,
	looksPersonToPerson,
	type MonthKey,
	monthOfDay,
	parentNamedIn,
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
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ArrowLeftRight, Ellipsis, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { useBetweenUs, useIncome } from "../extra-income";
import { formatMoney, formatMoneyInput, shortDay } from "../format";
import type { GoalView } from "../goals";
import { membersQuery, monthQuery } from "../queries";
import { AmountInput, AmountSheet } from "./goals";
import { parentNames } from "./review-between-us";
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
	const between = useBetweenUs();
	// Read beside the month's inputs, so both pages that list Income show it without passing it on.
	const { data: betweenUs } = useQuery({
		...monthQuery(month),
		select: (data) => data.betweenUs,
	});
	return (
		<>
			<IncomeSection
				baseline={baseline}
				income={income}
				betweenUs={betweenUs}
				onBetweenUs={(entry) => between.mark.mutate({ transferId: ulid(), month, entry })}
				onCountAgain={(entry) =>
					between.unmark.mutate({ transferId: entry.transferId, month, entry })
				}
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

/**
 * The month's income against the Take-home pay: what came in, and each entry (removable this
 * month). Income a Parent marked as "Between us" is listed under it, outside the total.
 */
export function IncomeSection({
	baseline,
	income,
	betweenUs = [],
	canRecord,
	onAdd,
	onRemove,
	onBetweenUs,
	onCountAgain,
}: {
	baseline: Cents;
	/** This month's income. */
	income: IncomeRecord[];
	/** This month's income marked as money between the two Parents: not in the total. */
	betweenUs?: BetweenUsIncome[];
	/** Marks an entry as money from the other Parent; without it the choice isn't offered. */
	onBetweenUs?: (income: IncomeRecord) => void;
	onCountAgain?: (income: BetweenUsIncome) => void;
	/** Income is recorded today, so only this month takes it. */
	canRecord: boolean;
	onAdd: () => void;
	onRemove: (income: IncomeRecord) => void;
}) {
	const hydrated = useHydrated();
	// The Parents' names: a deposit naming one of them reads as money between the two.
	const names = parentNames(useQuery(membersQuery()).data ?? []);
	const received = income.reduce((sum, i) => sum + i.amount, 0);
	const between = betweenUs.reduce((sum, i) => sum + i.amount, 0);
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
			{/* A container on a phone: with text at 200% "take-home pay" may break, as the pair is
			    wider than the screen then. */}
			<div className="max-sm:@container">
				<p className="pb-2 text-sm text-muted-foreground">
					<span className="font-medium text-foreground tabular-nums">{formatMoney(received)}</span>{" "}
					received of {formatMoney(baseline)} usual{" "}
					<span className="whitespace-nowrap @max-[12rem]:whitespace-normal">take-home pay</span>
				</p>
			</div>
			{income.length > 0 ? (
				<List>
					{income.map((entry) => (
						<ListRow
							key={entry.id}
							title={entry.note ?? "Income"}
							meta={
								onBetweenUs && looksPersonToPerson(entry.note, names) ? (
									// The answer stays whole: on a narrow phone it goes to the next line
									// together, never "us" alone (issue 74).
									<>
										{shortDay(entry.date)} · From{" "}
										{parentNamedIn(entry.note, names) ?? "the other Parent"}?{" "}
										<span className="whitespace-nowrap">It’s between us</span>
									</>
								) : (
									shortDay(entry.date)
								)
							}
							trailing={
								<div className="flex items-center gap-1">
									{/* The weight every list's amount has (issue 73). */}
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(entry.amount)}
									</span>
									{canRecord || onBetweenUs ? (
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
												{onBetweenUs ? (
													<DropdownMenuItem onSelect={() => onBetweenUs(entry)}>
														<ArrowLeftRight />
														It’s between us · not Income
													</DropdownMenuItem>
												) : null}
												{canRecord ? (
													<DropdownMenuItem variant="destructive" onSelect={() => onRemove(entry)}>
														<Trash2 />
														Remove income
													</DropdownMenuItem>
												) : null}
											</DropdownMenuContent>
										</DropdownMenu>
									) : null}
								</div>
							}
						/>
					))}
				</List>
			) : null}
			{betweenUs.length > 0 ? (
				<section aria-label="Between us" className="grid gap-2 pt-4">
					<p className="text-sm text-muted-foreground sm:px-1">
						<span className="font-medium text-foreground">Between us</span>{" "}
						<span className="tabular-nums">{formatMoney(between)}</span> one of you moved to the
						other. It isn’t Income and it isn’t spending.
					</p>
					<List>
						{betweenUs.map((entry) => (
							<ListRow
								key={entry.id}
								title={entry.note ?? "Money in"}
								meta={`Between us · ${shortDay(entry.date)}`}
								trailing={
									// On the narrowest phones the amount sits over the button, so the name and its
									// date keep a line each.
									<div className="flex items-center gap-1 max-[359px]:flex-col max-[359px]:items-end max-[359px]:gap-0">
										<span className="text-muted-foreground tabular-nums">
											{formatMoney(entry.amount)}
										</span>
										{onCountAgain ? (
											<Button
												variant="ghost"
												size="sm"
												className="max-[359px]:-mr-2.5"
												disabled={!hydrated}
												aria-label={`Count ${formatMoney(entry.amount)} as Income`}
												onClick={() => onCountAgain(entry)}
											>
												Count as Income
											</Button>
										) : null}
									</div>
								}
							/>
						))}
					</List>
				</section>
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
			<p className="pb-3 text-sm text-muted-foreground">
				<span className="font-medium text-foreground tabular-nums">{formatMoney(left)}</span> came
				in above your usual take-home pay{monthName ? ` in ${monthName}` : ""}. Add it to Free to
				Spend to use it, or choose a Goal or Bucket for it.
			</p>
			<div className="flex flex-wrap gap-2 pb-3 sm:px-1">
				{/* The amount is in the words, so the name read out is the one seen; it may wrap (#74). */}
				<Button size="wrap" disabled={!hydrated} onClick={onAddToFree}>
					Add {formatMoney(left)} to Free to Spend
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
	// Free to Spend first: Extra income is there to be used unless the Parent picks a place (#86).
	const [destination, setDestination] = useState(FREE_TO_SPEND);
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
