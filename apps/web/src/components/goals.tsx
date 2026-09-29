import {
	ACCOUNT_KINDS,
	type AccountKind,
	type Cents,
	type DayKey,
	parseDollars,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { Link, useHydrated } from "@tanstack/react-router";
import { ChevronLeft, CreditCard, HandCoins, Landmark, PiggyBank, Plus } from "lucide-react";
import { type ComponentProps, type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, formatMoneyInput, fullDay } from "../format";
import {
	type AccountView,
	type AddAccountVariables,
	type AddGoalVariables,
	accountKindName,
	type GoalView,
	goalStatusName,
} from "../goals";
import { NativeSelect } from "./native-select";

/** The Goal and Account pages' way back to Goals. */
export function BackToGoals() {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/goals" aria-label="Back to Goals">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
}

/** Each kind of Account's icon. */
export const accountIcons = {
	checking: Landmark,
	savings: PiggyBank,
	"credit-card": CreditCard,
	loan: HandCoins,
} as const;

/** A row that opens somewhere, laid out like a ListRow. */
export function LinkRow({
	link,
	label,
	leading,
	title,
	meta,
	trailing,
	below,
}: {
	link: (props: { className: string; children: ReactNode; "aria-label": string }) => ReactNode;
	label: string;
	leading?: ReactNode;
	title: ReactNode;
	meta?: ReactNode;
	trailing?: ReactNode;
	below?: ReactNode;
}) {
	return (
		<li data-slot="list-row">
			{link({
				"aria-label": label,
				className: cn(
					"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-(--card-pad) py-3.5 text-start",
					!leading && "grid-cols-[minmax(0,1fr)_auto]",
					"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
					"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
				),
				children: (
					<>
						{leading}
						<span className="grid min-w-0 gap-0.5">
							<span className="truncate text-sm font-medium">{title}</span>
							{meta ? (
								<span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground">
									{meta}
								</span>
							) : null}
						</span>
						{trailing ? (
							<span className="grid justify-items-end gap-0.5 text-end">{trailing}</span>
						) : null}
						{below ? (
							<span className={leading ? "col-start-2 col-end-4" : "col-span-2"}>{below}</span>
						) : null}
					</>
				),
			})}
		</li>
	);
}

/** A dollar amount typed freely, with a "$" before it; parse it with `parseDollars`. */
export function AmountInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
	return (
		<div className={cn("relative", className)}>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground text-sm"
			>
				$
			</span>
			<Input
				type="text"
				inputMode="decimal"
				autoComplete="off"
				className="pl-6 tabular-nums"
				{...props}
			/>
		</div>
	);
}

/** How much of a Goal's target is saved: a quiet bar, no colour. */
export function GoalProgressBar({ share, className }: { share: number; className?: string }) {
	const pct = `${(Math.min(1, Math.max(0, share)) * 100).toFixed(2)}%`;
	return (
		<div aria-hidden="true" className={cn("relative h-1.5 rounded-full bg-surface-3", className)}>
			<div
				className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground transition-[width] duration-(--duration-meter) ease-spring"
				style={{ width: pct }}
			/>
		</div>
	);
}

/**
 * A Goal's plan in words: what it needs a month and how it's doing, and its target date. Behind
 * is a Pace state and past due an over state, the only ones with colour.
 */
export function GoalSummary({ goal }: { goal: GoalView }) {
	const { progress, targetDate } = goal;
	const parts: ReactNode[] = [];
	if (goal.state === "archived") {
		parts.push("Archived");
	} else if (progress.status === "reached") {
		parts.push(goalStatusName.reached);
	} else if (goal.state === "completed") {
		parts.push("Completed");
	} else {
		if (progress.monthly !== null) parts.push(`${formatMoney(progress.monthly)} a month`);
		if (progress.status === "behind") {
			parts.push(<Badge variant="pace">{goalStatusName.behind}</Badge>);
		} else if (progress.status === "past-due") {
			parts.push(<Badge variant="over">{goalStatusName["past-due"]}</Badge>);
		} else if (progress.status === "on-track") {
			parts.push(goalStatusName["on-track"]);
		}
	}
	if (goal.state !== "archived") {
		parts.push(targetDate ? `by ${fullDay(targetDate)}` : "No target date");
	}
	return (
		<>
			{parts.map((part, index) => (
				// The parts are fixed per state, so their positions are stable keys.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<span key={index} className="inline-flex items-center gap-1.5">
					{index > 0 ? <span aria-hidden="true">·</span> : null}
					{part}
				</span>
			))}
		</>
	);
}

/**
 * How an Account's money splits, in words: "Earmarked $X · Unclaimed $Y", or, when the Earmarks
 * add up to more than the balance, that said plainly (`over`: show it in the over colour).
 * Null when there's nothing to say: a credit card or loan, or no balance and no Earmarks.
 */
export function accountSplitText(account: AccountView): { text: string; over: boolean } | null {
	if (!account.holdsMoney) return null;
	// Without a balance there's no Unclaimed to show; the balance itself says it's missing.
	if (account.unclaimed === null) {
		return account.earmarked !== 0
			? { text: `Earmarked ${formatMoney(account.earmarked)}`, over: false }
			: null;
	}
	if (account.overClaimedBy > 0) {
		return {
			text: `Earmarks are ${formatMoney(account.overClaimedBy)} more than the balance`,
			over: true,
		};
	}
	return {
		text: `Earmarked ${formatMoney(account.earmarked)} · Unclaimed ${formatMoney(account.unclaimed)}`,
		over: false,
	};
}

/** The Account's balance, or what's owed on a credit card or loan. */
export const balanceLabel = (account: Pick<AccountView, "balance" | "holdsMoney">) =>
	account.balance === null
		? "No balance yet"
		: account.holdsMoney
			? formatMoney(account.balance)
			: `${formatMoney(account.balance)} owed`;

/** Adds an Account, in a card on the page: used before the Household has any. */
export function AddAccountForm({ onAdd }: { onAdd: (account: AddAccountVariables) => void }) {
	return (
		<Card className="grid gap-3 p-(--card-pad)">
			<p className="text-sm font-semibold">Add an Account</p>
			<AccountFields onAdd={onAdd} submit="secondary" />
		</Card>
	);
}

/** Adds an Account, in a sheet. */
export function AddAccountSheet({
	open,
	onOpenChange,
	onAdd,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd: (account: AddAccountVariables) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader
						title="Add an Account"
						description="A checking or savings Account can hold Goals; a credit card or loan is tracked by what’s owed."
					/>
					<AccountFields onAdd={onAdd} submit="default" />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

/** An Account's name, kind, and (if known) its balance now. */
function AccountFields({
	onAdd,
	submit,
}: {
	onAdd: (account: AddAccountVariables) => void;
	submit: "default" | "secondary";
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [kind, setKind] = useState<AccountKind>("checking");
	const [balance, setBalance] = useState("");
	const balanceCents = balance.trim() === "" ? null : parseDollars(balance);
	const balanceInvalid = balance.trim() !== "" && balanceCents === null;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const name = String(new FormData(form).get("name") ?? "").trim();
		if (!name || balanceInvalid) return;
		onAdd({ accountId: ulid(), name, kind, balanceCents, balanceId: ulid() });
		form.reset();
		setBalance("");
	}

	const owes = kind === "credit-card" || kind === "loan";
	return (
		<form onSubmit={onSubmit} className="grid gap-3">
			<div className="grid gap-3 sm:grid-cols-2">
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						name="name"
						required
						maxLength={40}
						autoComplete="off"
						placeholder="e.g. Ally savings"
						disabled={!hydrated}
					/>
				</Field>
				<Field label="Kind" htmlFor={`${id}-kind`}>
					<NativeSelect
						id={`${id}-kind`}
						disabled={!hydrated}
						value={kind}
						onChange={(event) => setKind(event.currentTarget.value as AccountKind)}
					>
						{ACCOUNT_KINDS.map((k) => (
							<option key={k} value={k}>
								{accountKindName[k]}
							</option>
						))}
					</NativeSelect>
				</Field>
			</div>
			<Field
				label={owes ? "Owed now" : "Balance now"}
				htmlFor={`${id}-balance`}
				hint={
					owes
						? "What’s owed on it today. Optional."
						: "What’s in it today, from your bank. Optional; you can add it later."
				}
			>
				<AmountInput
					id={`${id}-balance`}
					disabled={!hydrated}
					value={balance}
					placeholder="0"
					aria-invalid={balanceInvalid || undefined}
					onChange={(event) => setBalance(event.currentTarget.value)}
				/>
			</Field>
			<Button
				type="submit"
				variant={submit}
				className={submit === "secondary" ? "justify-self-start" : undefined}
				disabled={!hydrated}
			>
				{submit === "secondary" ? <Plus /> : null}
				Add Account
			</Button>
		</form>
	);
}

/**
 * Adds a Goal: a name, a target, an optional target date, the checking or savings Account it's
 * set aside in, and what's already set aside there for it (claimed from Unclaimed money).
 */
export function AddGoalSheet({
	open,
	onOpenChange,
	accounts,
	today,
	onAdd,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Every Account; only those that hold money are offered. */
	accounts: AccountView[];
	today: DayKey;
	onAdd: (goal: AddGoalVariables) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader
						title="Add a Goal"
						description="Money set aside in an Account for something ahead, funded a little each month."
					/>
					<AddGoalForm
						accounts={accounts.filter((a) => a.holdsMoney)}
						today={today}
						onAdd={onAdd}
					/>
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function AddGoalForm({
	accounts,
	today,
	onAdd,
}: {
	accounts: AccountView[];
	today: DayKey;
	onAdd: (goal: AddGoalVariables) => void;
}) {
	const id = useId();
	const [name, setName] = useState("");
	const [target, setTarget] = useState("");
	const [targetDate, setTargetDate] = useState("");
	const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
	const [claim, setClaim] = useState("");
	const targetCents = parseDollars(target);
	const claimCents = claim.trim() === "" ? 0 : parseDollars(claim);
	const account = accounts.find((a) => a.id === accountId);
	const dateInvalid = targetDate !== "" && targetDate < today;
	const valid =
		name.trim() !== "" &&
		targetCents !== null &&
		targetCents > 0 &&
		claimCents !== null &&
		!dateInvalid &&
		account !== undefined;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!valid || targetCents === null || claimCents === null || !account) return;
		onAdd({
			goalId: ulid(),
			accountId: account.id,
			name: name.trim(),
			targetCents,
			targetDate: targetDate === "" ? null : (targetDate as DayKey),
			claimId: ulid(),
			claimCents,
		});
	}

	const unclaimedHint = !account
		? "Add a checking or savings Account first."
		: account.unclaimed === null
			? `${account.name} has no balance yet, so nothing there is Unclaimed.`
			: account.unclaimed <= 0
				? `Nothing in ${account.name} is Unclaimed.`
				: `${formatMoney(account.unclaimed)} in ${account.name} is Unclaimed.`;

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field label="Name" htmlFor={`${id}-name`}>
				<Input
					id={`${id}-name`}
					required
					maxLength={40}
					autoComplete="off"
					placeholder="e.g. Braces"
					value={name}
					onChange={(event) => setName(event.currentTarget.value)}
				/>
			</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Target" htmlFor={`${id}-target`}>
					<AmountInput
						id={`${id}-target`}
						required
						placeholder="0"
						value={target}
						aria-invalid={(target !== "" && !(targetCents && targetCents > 0)) || undefined}
						onChange={(event) => setTarget(event.currentTarget.value)}
					/>
				</Field>
				<Field
					label="Target date"
					htmlFor={`${id}-date`}
					hint={dateInvalid ? "Pick today or a day ahead." : "Optional."}
				>
					<Input
						id={`${id}-date`}
						type="date"
						min={today}
						value={targetDate}
						aria-invalid={dateInvalid || undefined}
						onChange={(event) => setTargetDate(event.currentTarget.value)}
					/>
				</Field>
			</div>
			<Field
				label="Account"
				htmlFor={`${id}-account`}
				hint="Where the money is set aside: a checking or savings Account."
			>
				<NativeSelect
					id={`${id}-account`}
					value={accountId}
					onChange={(event) => setAccountId(event.currentTarget.value)}
				>
					{accounts.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field label="Already set aside" htmlFor={`${id}-claim`} hint={unclaimedHint}>
				<AmountInput
					id={`${id}-claim`}
					placeholder="0"
					value={claim}
					aria-invalid={claimCents === null || undefined}
					onChange={(event) => setClaim(event.currentTarget.value)}
				/>
			</Field>
			<Button type="submit" disabled={!valid}>
				Add Goal
			</Button>
		</form>
	);
}

/** What an amount sheet says under the amount, and whether the amount can't be saved. */
export type AmountCheck = { hint: ReactNode; refused?: boolean };

/**
 * One amount (and, for spending, a note) in a sheet: Fund, Spend, Set aside, Release, a new
 * balance. `check` explains the amount as it's typed; a refused amount can't be saved and its
 * hint is in the over colour.
 */
export function AmountSheet({
	open,
	onOpenChange,
	title,
	description,
	label = "Amount",
	initialCents,
	allowZero = false,
	withNote = false,
	notePlaceholder,
	submitLabel,
	check,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	label?: string;
	/** Prefilled amount, if any. */
	initialCents?: Cents | null;
	allowZero?: boolean;
	withNote?: boolean;
	notePlaceholder?: string;
	submitLabel: string;
	check: (cents: Cents | null) => AmountCheck;
	onSave: (cents: Cents, note: string | null) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader title={title} description={description} />
					<AmountForm
						label={label}
						initialCents={initialCents}
						allowZero={allowZero}
						withNote={withNote}
						notePlaceholder={notePlaceholder}
						submitLabel={submitLabel}
						check={check}
						onSave={onSave}
					/>
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function AmountForm({
	label,
	initialCents,
	allowZero,
	withNote,
	notePlaceholder = "e.g. First payment",
	submitLabel,
	check,
	onSave,
}: {
	label: string;
	initialCents?: Cents | null;
	allowZero: boolean;
	withNote: boolean;
	notePlaceholder?: string;
	submitLabel: string;
	check: (cents: Cents | null) => AmountCheck;
	onSave: (cents: Cents, note: string | null) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [amount, setAmount] = useState(() =>
		initialCents != null && (initialCents > 0 || allowZero) ? formatMoneyInput(initialCents) : "",
	);
	const [note, setNote] = useState("");
	const cents = parseDollars(amount);
	const { hint, refused = false } = check(cents);
	const valid = cents !== null && (allowZero || cents > 0) && !refused;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (valid && cents !== null) onSave(cents, note.trim() === "" ? null : note.trim());
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field
				label={label}
				htmlFor={`${id}-amount`}
				hint={<span className={cn(refused && "text-over")}>{hint}</span>}
			>
				<AmountInput
					id={`${id}-amount`}
					placeholder="0"
					enterKeyHint={withNote ? "next" : "done"}
					value={amount}
					aria-invalid={(amount !== "" && !valid) || undefined}
					onChange={(event) => setAmount(event.currentTarget.value)}
				/>
			</Field>
			{withNote ? (
				<Field label="Note" htmlFor={`${id}-note`} hint="Optional.">
					<Input
						id={`${id}-note`}
						maxLength={80}
						autoComplete="off"
						placeholder={notePlaceholder}
						value={note}
						onChange={(event) => setNote(event.currentTarget.value)}
					/>
				</Field>
			) : null}
			<Button type="submit" disabled={!hydrated || !valid}>
				{submitLabel}
			</Button>
		</form>
	);
}

/**
 * Funds a Goal from this month's Free to Spend: a Move into its Earmark. Starts at what's left
 * to fund this month; more than Free to Spend has can't be moved, and the sheet says how much
 * there is.
 */
export function FundGoalSheet({
	goal,
	freeToSpend,
	onOpenChange,
	onFund,
}: {
	/** The Goal to fund; the sheet is closed while null. */
	goal: GoalView | null;
	/** This month's Free to Spend. */
	freeToSpend: Cents;
	onOpenChange: (open: boolean) => void;
	onFund: (goal: GoalView, amountCents: Cents) => void;
}) {
	const left = goal?.progress.leftThisMonth ?? 0;
	return (
		<AmountSheet
			// Keyed so reopening for another Goal starts from its own amount.
			key={goal?.id}
			open={goal !== null}
			onOpenChange={onOpenChange}
			title={`Fund ${goal?.name ?? "Goal"}`}
			description="Moves money from this month’s Free to Spend into the Goal’s Earmark."
			initialCents={left}
			submitLabel="Fund"
			check={(cents) =>
				cents !== null && cents > freeToSpend
					? {
							hint: `Free to Spend has only ${formatMoney(Math.max(0, freeToSpend))} this month.`,
							refused: true,
						}
					: {
							hint:
								left > 0 && goal
									? `${goal.name} needs ${formatMoney(left)} more this month. Free to Spend has ${formatMoney(freeToSpend)}.`
									: `Free to Spend has ${formatMoney(freeToSpend)} this month.`,
						}
			}
			onSave={(cents) => {
				if (goal) onFund(goal, cents);
			}}
		/>
	);
}
