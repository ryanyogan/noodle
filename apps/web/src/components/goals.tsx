import {
	ACCOUNT_KINDS,
	type AccountKind,
	addMonths,
	type Cents,
	canPayOff,
	type DayKey,
	type GoalKind,
	type MonthKey,
	parseDollars,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { MetaParts } from "@noodle/ui/components/meta-parts";
import { OptionSelect } from "@noodle/ui/components/select";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { Link, linkOptions, useHydrated } from "@tanstack/react-router";
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
	statusNameOf,
	useGoals,
} from "../goals";
import { DetailPager } from "./master-detail";
import { PurchasesField, usePurchasesAnswer } from "./purchases-field";
import { TermHelp } from "./term-help";

/** A Goal page's way back to Goals. */
export function BackToGoals() {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/goals" aria-label="Back to Goals">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
}

/** An Account page's way back to Accounts. */
export function BackToAccounts() {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/accounts" aria-label="Back to Accounts">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
}

/** Goals in the order their list shows them: paying off, saving for, completed, archived. */
export function goalOrder(goals: readonly GoalView[]) {
	const active = goals.filter((g) => g.state === "active");
	return [
		...active.filter((g) => g.kind === "payoff"),
		...active.filter((g) => g.kind === "save"),
		...goals.filter((g) => g.state === "completed"),
		...goals.filter((g) => g.state === "archived"),
	].map((g) => g.id);
}

/** Previous and next Goal, in the list's order. */
export function GoalPager({ id }: { id: string }) {
	const { goals } = useGoals();
	return (
		<DetailPager
			ids={goalOrder(goals)}
			id={id}
			noun="Goal"
			link={(goalId) => linkOptions({ to: "/goals/$goalId", params: { goalId } })}
		/>
	);
}

/** Previous and next Account, in the list's order: cash, then cards and loans. */
export function AccountPager({ id }: { id: string }) {
	const { accounts } = useGoals();
	const ids = [...accounts.filter((a) => a.holdsMoney), ...accounts.filter((a) => !a.holdsMoney)];
	return (
		<DetailPager
			ids={ids.map((a) => a.id)}
			id={id}
			noun="Account"
			link={(accountId) => linkOptions({ to: "/accounts/$accountId", params: { accountId } })}
		/>
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
	trailingOnTitle,
	trailingClassName,
	className,
}: {
	link: (props: { className: string; children: ReactNode; "aria-label": string }) => ReactNode;
	label: string;
	leading?: ReactNode;
	title: ReactNode;
	meta?: ReactNode;
	trailing?: ReactNode;
	below?: ReactNode;
	/** Below `sm`, put the trailing amount on the title's line, so the meta under them takes the full width. */
	trailingOnTitle?: boolean;
	/** Where the trailing amount goes from a width up, e.g. on its own line on a card. */
	trailingClassName?: string;
	/** For the link, which is the row's grid: e.g. how its parts sit when the row is a card. */
	className?: string;
}) {
	// On a phone the text's parts become cells of the row's grid: title and trailing share the
	// first line, the meta spans the line under them.
	const phone = trailingOnTitle;
	return (
		<li data-slot="list-row">
			{link({
				"aria-label": label,
				className: cn(
					"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-(--card-pad) py-3.5 text-start",
					!leading && "grid-cols-[minmax(0,1fr)_auto]",
					"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
					"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
					phone && "max-sm:gap-y-0.5",
					className,
				),
				children: (
					<>
						{leading}
						<span className={cn("grid min-w-0 gap-0.5", phone && "max-sm:contents")}>
							<span
								className={cn(
									"line-clamp-2 text-sm font-medium break-words",
									phone && "max-sm:col-start-2 max-sm:row-start-1",
								)}
							>
								{title}
							</span>
							{meta ? (
								<span
									className={cn(
										"flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground",
										phone && "max-sm:col-start-2 max-sm:col-end-4 max-sm:row-start-2",
									)}
								>
									{meta}
								</span>
							) : null}
						</span>
						{trailing ? (
							<span
								className={cn(
									"grid justify-items-end gap-0.5 text-end",
									phone && "max-sm:col-start-3 max-sm:row-start-1 max-sm:self-start",
									trailingClassName,
								)}
							>
								{trailing}
							</span>
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
				enterKeyHint="done"
				className="pl-6 tabular-nums"
				{...props}
			/>
		</div>
	);
}

/**
 * How much of a Goal's target is saved: the one bar (BudgetBar), filling toward the target in the
 * brand ink. Decorative: the row beside it says the same in words, and it often sits inside a
 * link, where a meter can't.
 */
export function GoalProgressBar({ share, className }: { share: number; className?: string }) {
	return <BudgetBar value={share} max={1} className={className} />;
}

/**
 * A Goal's plan in words: what it needs a month and how it's doing, and its target date. Behind
 * is a Pace state and past due an over state, the only ones with colour.
 */
/** A Goal's funding over the three months before `month`, a month on average. */
const recentFunding = (goal: GoalView, month: MonthKey): Cents => {
	const from = addMonths(month, -3);
	const funded = goal.changes
		.filter((c) => c.kind === "funding" && c.month >= from && c.month < month)
		.reduce((sum, c) => sum + c.amount, 0);
	return Math.round(funded / 3);
};

export function GoalSummary({
	goal,
	month,
	before,
	after,
}: {
	goal: GoalView;
	month?: MonthKey;
	/** Facts to show first or last, joined like the rest. */
	before?: ReactNode;
	after?: ReactNode;
}) {
	const { progress, targetDate } = goal;
	const parts: ReactNode[] = [];
	if (goal.state === "archived") {
		parts.push("Archived");
	} else if (progress.status === "reached") {
		parts.push(statusNameOf(goal, "reached"));
	} else if (goal.state === "completed") {
		// Done: what it was spent on and what's left, not what it never reached.
		const spent = -goal.changes
			.filter((c) => c.kind === "spending")
			.reduce((sum, c) => sum + c.amount, 0);
		parts.push("Completed");
		if (spent > 0) parts.push(`spent ${formatMoney(spent)}`);
		parts.push(`${formatMoney(progress.saved)} still set aside`);
	} else {
		if (progress.monthly !== null) parts.push(`${formatMoney(progress.monthly)} a month`);
		else if (month && !targetDate) {
			// Undated: what it has been funded lately, in place of what it needs.
			const lately = recentFunding(goal, month);
			if (lately > 0) parts.push(`about ${formatMoney(lately)} a month lately`);
		}
		if (progress.status === "behind") {
			parts.push(<Badge variant="pace">{goalStatusName.behind}</Badge>);
		} else if (progress.status === "past-due") {
			parts.push(<Badge variant="over">{goalStatusName["past-due"]}</Badge>);
		} else if (progress.status === "on-track") {
			parts.push(goalStatusName["on-track"]);
		}
	}
	if (goal.state === "active" || progress.status === "reached") {
		parts.push(targetDate ? `by ${fullDay(targetDate)}` : "No target date");
	}
	return <MetaParts parts={[before, ...parts, after]} />;
}

/**
 * How an Account's money splits, in words: "Set aside $X · Not set aside $Y", or, when Goals have
 * set aside more than the balance, that said plainly (`over`: show it in the over colour).
 * Null when there's nothing to say: a credit card or loan, or no balance and nothing set aside.
 */
export function accountSplitText(account: AccountView): { text: string; over: boolean } | null {
	if (!account.holdsMoney) return null;
	// Without a balance there's nothing to show as not set aside; the balance itself says it's missing.
	if (account.unclaimed === null) {
		return account.earmarked !== 0
			? { text: `Set aside ${formatMoney(account.earmarked)}`, over: false }
			: null;
	}
	if (account.overClaimedBy > 0) {
		return {
			text: `Goals have set aside ${formatMoney(account.overClaimedBy)} more than the balance`,
			over: true,
		};
	}
	return {
		text: `Set aside ${formatMoney(account.earmarked)} · Not set aside ${formatMoney(account.unclaimed)}`,
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
	onConnect,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd: (account: AddAccountVariables) => void;
	/** Connects a bank instead: offered first, as the way that keeps itself up to date. */
	onConnect?: () => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader
						title="Add an Account"
						description="Add one yourself, then upload its statements or keep its balance up to date. A checking or savings Account can hold Goals; a credit card or loan is tracked by what’s owed."
					/>
					{onConnect ? (
						<div className="grid gap-2 rounded-2xl bg-surface-2 p-3 text-[13px] text-muted-foreground">
							<p>
								<span className="font-semibold text-foreground">Or connect your bank:</span> it
								brings in balances and spending on its own, every day, and pairs with Accounts you
								have already.
							</p>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="justify-self-start"
								onClick={onConnect}
							>
								Connect a bank
							</Button>
						</div>
					) : null}
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
	// The name as typed, for what it suggests about a card's purchases (an Apple Card: by hand).
	const [name, setName] = useState("");
	const purchases = usePurchasesAnswer(name);
	const [balance, setBalance] = useState("");
	const balanceCents = balance.trim() === "" ? null : parseDollars(balance);
	const balanceInvalid = balance.trim() !== "" && balanceCents === null;
	const [nameMissing, setNameMissing] = useState(false);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const name = String(new FormData(form).get("name") ?? "").trim();
		setNameMissing(!name);
		// A credit card isn't added until a Parent has said how its purchases get in.
		const answered = kind === "credit-card" ? purchases.check() : null;
		if (!name) {
			form.querySelector<HTMLInputElement>("[name=name]")?.focus();
			return;
		}
		if (kind === "credit-card" && answered === null) {
			document.getElementById(`${id}-purchases`)?.focus();
			return;
		}
		if (balanceInvalid) return;
		onAdd({
			accountId: ulid(),
			name,
			kind,
			balanceCents,
			balanceId: ulid(),
			purchases: answered,
		});
		form.reset();
		setName("");
		purchases.reset();
		setBalance("");
	}

	const owes = kind === "credit-card" || kind === "loan";
	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-3">
			<div className="grid gap-3 sm:grid-cols-2">
				<Field
					label="Name"
					htmlFor={`${id}-name`}
					error={nameMissing ? "Give the Account a name." : null}
				>
					<Input
						id={`${id}-name`}
						name="name"
						required
						aria-invalid={nameMissing || undefined}
						aria-describedby={nameMissing ? `${id}-name-error` : undefined}
						onChange={(event) => {
							setName(event.currentTarget.value);
							setNameMissing(false);
						}}
						maxLength={40}
						autoComplete="off"
						placeholder="e.g. Ally savings"
						disabled={!hydrated}
					/>
				</Field>
				<Field label="Kind" htmlFor={`${id}-kind`}>
					<OptionSelect
						id={`${id}-kind`}
						disabled={!hydrated}
						value={kind}
						onValueChange={(value) => setKind(value as AccountKind)}
						choices={ACCOUNT_KINDS.map((k) => ({ value: k, label: accountKindName[k] }))}
					/>
				</Field>
			</div>
			{kind === "credit-card" ? (
				<PurchasesField id={`${id}-purchases`} answer={purchases} disabled={!hydrated} />
			) : null}
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
 * Adds a Goal. It starts with what for: saving up (a name, a target, an optional target date, the
 * checking or savings Account it's set aside in, and what's already set aside there) or paying off
 * a credit card or loan (ADR-0019: the card or loan, whose balance now is the target, a name and
 * an optional date). `kind` and `accountId` start it on one; `lockKind` hides the choice.
 */
export function AddGoalSheet({
	open,
	onOpenChange,
	accounts,
	goals,
	today,
	onAdd,
	kind: initialKind = "save",
	accountId,
	lockKind = false,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Every Account; each kind of Goal offers the ones it can use. */
	accounts: AccountView[];
	/** Every Goal, so a card or loan already being paid off isn't offered again. */
	goals: Pick<GoalView, "kind" | "accountId" | "state">[];
	today: DayKey;
	onAdd: (goal: AddGoalVariables) => void;
	kind?: GoalKind;
	accountId?: string;
	lockKind?: boolean;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<AddGoalChoice
						accounts={accounts}
						goals={goals}
						today={today}
						onAdd={onAdd}
						initialKind={initialKind}
						accountId={accountId}
						lockKind={lockKind}
					/>
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function AddGoalChoice({
	accounts,
	goals,
	today,
	onAdd,
	initialKind,
	accountId,
	lockKind,
}: {
	accounts: AccountView[];
	goals: Pick<GoalView, "kind" | "accountId" | "state">[];
	today: DayKey;
	onAdd: (goal: AddGoalVariables) => void;
	initialKind: GoalKind;
	accountId?: string;
	lockKind: boolean;
}) {
	const [kind, setKind] = useState<GoalKind>(initialKind);
	// A card or loan with an active payoff Goal is already being paid off.
	const payingOff = new Set(
		goals.filter((g) => g.kind === "payoff" && g.state === "active").map((g) => g.accountId),
	);
	return (
		<>
			<SheetHeader
				title={kind === "payoff" ? "Pay off a card or loan" : "Add a Goal"}
				description={
					kind === "payoff"
						? "Plan extra payments each month from Free to Spend, and watch what’s owed come down to $0."
						: "Money set aside in an Account for something ahead, funded a little each month."
				}
			/>
			<div className="grid gap-4">
				{lockKind ? null : <GoalKindField kind={kind} onKindChange={setKind} />}
				{kind === "payoff" ? (
					<PayoffGoalForm
						accounts={accounts.filter((a) => canPayOff(a.kind) && !payingOff.has(a.id))}
						initialAccountId={accountId}
						today={today}
						onAdd={onAdd}
					/>
				) : (
					<AddGoalForm
						accounts={accounts.filter((a) => a.holdsMoney)}
						today={today}
						onAdd={onAdd}
					/>
				)}
			</div>
		</>
	);
}

/** Save up, or pay off a card or loan: two options side by side. */
function GoalKindField({
	kind,
	onKindChange,
}: {
	kind: GoalKind;
	onKindChange: (kind: GoalKind) => void;
}) {
	const hydrated = useHydrated();
	const labelId = useId();
	const options = [
		{ kind: "save", label: "Save up" },
		{ kind: "payoff", label: "Pay off a card or loan" },
	] as const;
	return (
		<div className="grid gap-1.5">
			<p className="mb-1.5 flex items-center gap-1 text-sm font-medium">
				<span id={labelId}>What’s it for?</span>
				<TermHelp term="payoff-goal" />
			</p>
			<ToggleGroup
				type="single"
				variant="segmented"
				aria-labelledby={labelId}
				value={kind}
				disabled={!hydrated}
				onValueChange={(value) => onKindChange(value as GoalKind)}
				className="grid w-full grid-cols-2"
			>
				{options.map((option) => (
					<ToggleGroupItem key={option.kind} value={option.kind} size="wrap">
						{option.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}

/**
 * A payoff Goal's fields: the card or loan (its balance now is the target), a name and an
 * optional target date. A card or loan with no balance, or owing nothing, can't be picked.
 */
function PayoffGoalForm({
	accounts,
	initialAccountId,
	today,
	onAdd,
}: {
	/** The credit cards and loans not already being paid off. */
	accounts: AccountView[];
	initialAccountId?: string;
	today: DayKey;
	onAdd: (goal: AddGoalVariables) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const owing = accounts.filter((a) => a.balance !== null && a.balance > 0);
	const [accountId, setAccountId] = useState(
		owing.find((a) => a.id === initialAccountId)?.id ?? owing[0]?.id ?? "",
	);
	const [name, setName] = useState<string | null>(null);
	const [targetDate, setTargetDate] = useState("");
	const account = owing.find((a) => a.id === accountId);
	const suggested = account ? `Pay off ${account.name}`.slice(0, 40) : "";
	const goalName = (name ?? suggested).trim();
	const dateInvalid = targetDate !== "" && targetDate < today;
	const valid = account !== undefined && goalName !== "" && !dateInvalid;

	if (owing.length === 0) {
		const noBalance = accounts.find((a) => a.balance === null);
		return (
			<div className="grid justify-items-start gap-3 text-sm text-muted-foreground">
				<p>
					{accounts.length === 0
						? "Add the credit card or loan on Accounts first, with what’s owed on it today."
						: noBalance
							? `Add what’s owed on ${noBalance.name} first, on its Account page.`
							: "None of your cards or loans owe anything right now."}
				</p>
				<Button variant="outline" size="sm" asChild>
					{noBalance ? (
						<Link to="/accounts/$accountId" params={{ accountId: noBalance.id }}>
							Go to {noBalance.name}
						</Link>
					) : (
						<Link to="/accounts">Go to Accounts</Link>
					)}
				</Button>
			</div>
		);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!valid || !account || account.balance === null) return;
		onAdd({
			goalId: ulid(),
			kind: "payoff",
			accountId: account.id,
			name: goalName,
			targetCents: account.balance,
			targetDate: targetDate === "" ? null : (targetDate as DayKey),
			claimId: ulid(),
			claimCents: 0,
		});
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field
				label="Card or loan"
				htmlFor={`${id}-account`}
				hint={
					account?.balance != null ? (
						<>
							<span className="font-medium text-foreground tabular-nums">
								{formatMoney(account.balance)}
							</span>{" "}
							owed today. That’s the target: the Goal is done when it’s $0.
						</>
					) : undefined
				}
			>
				<OptionSelect
					id={`${id}-account`}
					disabled={!hydrated}
					value={accountId}
					onValueChange={setAccountId}
					choices={owing.map((a) => ({ value: a.id, label: a.name }))}
				/>
			</Field>
			{/* One to a row: the name starts as "Pay off " and the Account's name, too long for half
			    the sheet. */}
			<div className="grid gap-4">
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						maxLength={40}
						autoComplete="off"
						value={name ?? suggested}
						aria-invalid={goalName === "" || undefined}
						onChange={(event) => setName(event.currentTarget.value)}
					/>
				</Field>
				<Field
					label="Paid off by"
					htmlFor={`${id}-date`}
					hint={dateInvalid ? "Pick today or a day ahead." : "Optional."}
				>
					<DatePicker
						id={`${id}-date`}
						min={today}
						value={targetDate}
						aria-invalid={dateInvalid || undefined}
						onChange={setTargetDate}
					/>
				</Field>
			</div>
			<p className="text-[13px] text-muted-foreground">
				Each month you plan extra payments from Free to Spend. A regular payment you already make,
				like a loan’s monthly payment, stays a Commitment; this is on top of it.
			</p>
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || !valid}>
					Add Goal
				</Button>
			</SheetFooter>
		</form>
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
			kind: "save",
			accountId: account.id,
			name: name.trim(),
			targetCents,
			targetDate: targetDate === "" ? null : (targetDate as DayKey),
			claimId: ulid(),
			claimCents,
		});
	}

	const notSetAsideHint = !account
		? "Add a checking or savings Account first."
		: account.unclaimed === null
			? `${account.name} has no balance yet, so there’s nothing to set aside from.`
			: account.unclaimed <= 0
				? `Everything in ${account.name} is already set aside.`
				: `${formatMoney(account.unclaimed)} in ${account.name} isn’t set aside yet.`;

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
					<DatePicker
						id={`${id}-date`}
						min={today}
						value={targetDate}
						aria-invalid={dateInvalid || undefined}
						onChange={setTargetDate}
					/>
				</Field>
			</div>
			<Field
				label="Account"
				htmlFor={`${id}-account`}
				hint="Where the money is set aside: a checking or savings Account."
			>
				<OptionSelect
					id={`${id}-account`}
					value={accountId}
					onValueChange={setAccountId}
					choices={accounts.map((a) => ({
						value: a.id,
						label: a.name,
						hint: a.unclaimed === null ? undefined : `${formatMoney(a.unclaimed)} not set aside`,
					}))}
				/>
			</Field>
			<Field label="Already set aside" htmlFor={`${id}-claim`} hint={notSetAsideHint}>
				<AmountInput
					id={`${id}-claim`}
					placeholder="0"
					value={claim}
					aria-invalid={claimCents === null || undefined}
					onChange={(event) => setClaim(event.currentTarget.value)}
				/>
			</Field>
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!valid}>
					Add Goal
				</Button>
			</SheetFooter>
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
	above,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	/** Fields above the amount, such as where the money comes from. */
	above?: ReactNode;
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
					{above}
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
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || !valid}>
					{submitLabel}
				</Button>
			</SheetFooter>
		</form>
	);
}

/**
 * Funds a Goal from this month's Free to Spend: a Move into what it has set aside. Starts at what's left
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
			description={
				goal?.kind === "payoff"
					? `Plans extra payments toward paying down ${goal.account?.name ?? "the card"} from this month’s Free to Spend. Then pay it from checking as usual.`
					: `Plans some of this month’s Free to Spend for ${goal?.name ?? "the Goal"}, and sets it aside.`
			}
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
