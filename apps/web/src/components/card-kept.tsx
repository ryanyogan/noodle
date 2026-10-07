import {
	type BalanceCheck,
	cardKeptUnasked,
	type DayKey,
	PURCHASES_GET_IN,
	type PurchasesGetIn,
	parseDollars,
	statementCheckDue,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import {
	balanceChecksPutAwayQuery,
	purchasesHint,
	purchasesName,
	walletQuestionsQuery,
} from "../card-kept";
import { formatMoney } from "../format";
import { type AccountView, useGoals, useSetCardKept } from "../goals";
import { goalsQuery, monthsKey } from "../queries";
import {
	answerWalletCard,
	checkStatementBalance,
	dismissWalletCard,
	putAwayBalanceCheck,
} from "../server/card-kept";
import { AmountInput } from "./goals";
import { markQuickAddOpened, quickAddSearch } from "./quick-add";

// A card says how its purchases get into Noodle (issue 136), and what follows for one kept by
// hand, like an Apple Card: the Wallet card its captures name, and once a month a check of its
// statement's balance against what's recorded.

const longDay = (day: DayKey) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

/** The statement day a card kept by hand is due a balance check for; null when none is due. */
export const checkDue = (account: AccountView, today: DayKey): DayKey | null =>
	account.kind === "credit-card" &&
	account.purchases === "hand" &&
	account.bankConnectionId === null
		? statementCheckDue({
				statementDay: account.statementDay,
				today,
				lastBalanceDay: account.latestBalance?.day ?? null,
			})
		: null;

/** What the check found, in the app's words. */
export function checkWords(check: BalanceCheck): string {
	if (check.kind === "matches") return "That matches.";
	return check.kind === "higher"
		? `${formatMoney(check.byCents)} higher than what’s recorded: add what’s missing, or import the statement.`
		: `${formatMoney(check.byCents)} lower than what’s recorded: a payment or money back may be missing, or something was added twice.`;
}

const inlineLink = "font-medium text-foreground underline underline-offset-3";

/**
 * What the check found, with its two ways out as links when the statement is higher: Quick Add
 * paid with this card, and the card's own Statements section.
 */
function CheckFound({ check, account }: { check: BalanceCheck; account: AccountView }) {
	if (check.kind !== "higher") return <>{checkWords(check)}</>;
	return (
		<>
			{formatMoney(check.byCents)} higher than what’s recorded:{" "}
			<Link
				to="."
				search={(prev) => ({ ...prev, ...quickAddSearch, paidWith: account.id })}
				resetScroll={false}
				onClick={markQuickAddOpened}
				className={inlineLink}
			>
				add what’s missing
			</Link>
			, or{" "}
			<Link to="." hash="account-statements" className={inlineLink}>
				import the statement
			</Link>
			.
		</>
	);
}

/**
 * On a credit card's page, when it doesn't sync with a bank: how its purchases get in (asked once
 * when no one has said), and for one kept by hand its statement day and the monthly balance check.
 */
export function CardKeptSection({ account }: { account: AccountView }) {
	const hydrated = useHydrated();
	const id = useId();
	const { asOf } = useGoals();
	const setKept = useSetCardKept();
	const [changing, setChanging] = useState(false);
	const asking = account.purchases === null || changing;

	function answer(purchases: PurchasesGetIn) {
		setKept.mutate({ accountId: account.id, purchases });
		setChanging(false);
	}

	return (
		<Section aria-labelledby={`${id}-kept`}>
			<SectionHeader id={`${id}-kept`} title="Purchases" />
			<Card>
				<div className="grid gap-3 p-(--card-pad)">
					{asking ? (
						<fieldset className="grid gap-2">
							<legend className="mb-2 text-sm font-semibold">
								How do purchases on {account.name} get into Noodle?
							</legend>
							{PURCHASES_GET_IN.map((purchases) => (
								<div key={purchases} className="grid gap-1">
									<Button
										type="button"
										variant={account.purchases === purchases ? "secondary" : "outline"}
										className="justify-self-start"
										disabled={!hydrated}
										onClick={() => answer(purchases)}
									>
										{purchasesName[purchases]}
									</Button>
									<p className="text-[13px] text-muted-foreground">{purchasesHint[purchases]}</p>
								</div>
							))}
						</fieldset>
					) : (
						<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
							<div className="grid min-w-0 gap-1">
								<p className="text-sm font-semibold">
									{account.purchases ? purchasesName[account.purchases] : null}
								</p>
								<p className="text-[13px] text-muted-foreground">
									{account.purchases ? purchasesHint[account.purchases] : null}
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={!hydrated}
								onClick={() => setChanging(true)}
							>
								Change
							</Button>
						</div>
					)}
				</div>
				{account.purchases === "hand" && !asking ? (
					<BalanceCheckForm account={account} today={asOf} />
				) : null}
			</Card>
		</Section>
	);
}

/** The statement day of a card kept by hand, and the check of its statement's balance. */
function BalanceCheckForm({ account, today }: { account: AccountView; today: DayKey }) {
	const hydrated = useHydrated();
	const id = useId();
	const queryClient = useQueryClient();
	const setKept = useSetCardKept();
	const due = checkDue(account, today);
	const [day, setDay] = useState(account.statementDay === null ? "" : String(account.statementDay));
	const [balance, setBalance] = useState("");
	const [found, setFound] = useState<BalanceCheck | null>(null);
	const check = useMutation({
		mutationFn: (statementCents: number) =>
			checkStatementBalance({
				data: { balanceId: ulid(), accountId: account.id, statementCents, asOf: due ?? today },
			}),
		onSuccess: (result) => {
			if (result.ok) {
				setFound(result.check);
				setBalance("");
			} else toast("Couldn’t check that balance.", { tone: "error" });
		},
		onError: () => toast("Couldn’t check that balance. Try again.", { tone: "error" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey }),
	});
	const statementDay = Number(day);
	const dayValid = Number.isInteger(statementDay) && statementDay >= 1 && statementDay <= 31;
	const cents = balance.trim() === "" ? null : parseDollars(balance);

	function saveDay(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (dayValid) setKept.mutate({ accountId: account.id, purchases: "hand", statementDay });
	}
	function runCheck(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (cents !== null) check.mutate(cents);
	}

	return (
		<div className="grid gap-4 border-t p-(--card-pad)">
			<form onSubmit={saveDay} noValidate className="flex flex-wrap items-end gap-3">
				<Field
					label="Statement closes on day"
					htmlFor={`${id}-day`}
					hint="Of the month, 1 to 31. Noodle asks for its balance then."
				>
					<Input
						id={`${id}-day`}
						inputMode="numeric"
						className="w-24"
						value={day}
						disabled={!hydrated}
						onChange={(event) => setDay(event.currentTarget.value)}
					/>
				</Field>
				<Button
					type="submit"
					variant="outline"
					disabled={!hydrated || !dayValid || statementDay === account.statementDay}
				>
					Save day
				</Button>
			</form>
			<form onSubmit={runCheck} noValidate className="grid gap-3 rounded-2xl bg-surface-2 p-3">
				<p role={due ? "status" : undefined} className="text-sm font-semibold">
					{due
						? `${account.name}’s statement closed on ${longDay(due)}. What’s its balance?`
						: "Check a statement’s balance"}
				</p>
				<div className="flex flex-wrap items-end gap-3">
					<Field
						label="Statement balance"
						htmlFor={`${id}-statement`}
						hint="Noodle compares it with the Quick Adds and payments recorded."
					>
						<AmountInput
							id={`${id}-statement`}
							value={balance}
							placeholder="0"
							disabled={!hydrated}
							onChange={(event) => setBalance(event.currentTarget.value)}
						/>
					</Field>
					<Button type="submit" disabled={!hydrated || cents === null || check.isPending}>
						Check balance
					</Button>
				</div>
				{found ? (
					<p role="status" className="text-sm">
						<CheckFound check={found} account={account} />
					</p>
				) : null}
			</form>
		</div>
	);
}

/**
 * On Accounts: the monthly balance check that's due on each card kept by hand (once per statement:
 * "Not now" puts it away for the Household, on every device, until the next one closes; the
 * card's own page still offers it), the cards no one has said how purchases get in for (unless
 * their statements came in lately), and the Wallet cards captures named that no Account is known
 * for, each asked once.
 */
export function CardNudges() {
	const hydrated = useHydrated();
	const queryClient = useQueryClient();
	const { accounts, asOf } = useGoals();
	const questions = useQuery(walletQuestionsQuery()).data ?? [];
	const answer = useMutation({
		mutationFn: (data: { card: string; accountId: string }) => answerWalletCard({ data }),
		onError: () => toast("Couldn’t save that. Try again.", { tone: "error" }),
		onSuccess: (result, { card }) => {
			const account = accounts.find((a) => a.id === answer.variables?.accountId);
			if (result.ok && account)
				toast(`${card} is ${account.name}. Wallet captures paid with it land there.`, {
					tone: "success",
				});
		},
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: monthsKey }),
				queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey }),
			]),
	});
	const none = useMutation({
		mutationFn: (card: string) => dismissWalletCard({ data: { card } }),
		onError: () => toast("Couldn’t save that. Try again.", { tone: "error" }),
		onSuccess: (result, card) => {
			if (result.ok) toast(`Noodle won’t ask about ${card} again.`);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
	// Nothing shows until what's been put away is known, so a check put away never flashes.
	const putAwayKey = balanceChecksPutAwayQuery().queryKey;
	const putAway = useQuery(balanceChecksPutAwayQuery()).data;
	const notNow = useMutation({
		mutationFn: (data: { accountId: string; day: DayKey }) => putAwayBalanceCheck({ data }),
		onMutate: async ({ accountId, day }) => {
			await queryClient.cancelQueries({ queryKey: putAwayKey });
			queryClient.setQueryData(putAwayKey, (kept: string[] | undefined) => [
				...(kept ?? []),
				`${accountId}:${day}`,
			]);
		},
		onError: () => toast("Couldn’t put that away. Try again.", { tone: "error" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: putAwayKey }),
	});
	const due = accounts.flatMap((account) => {
		const day = checkDue(account, asOf);
		return day && putAway && !putAway.includes(`${account.id}:${day}`) ? [{ account, day }] : [];
	});
	const cards = accounts.filter((a) => a.kind === "credit-card" && a.bankConnectionId === null);
	const unasked = cards.filter((a) => cardKeptUnasked(a, asOf));
	if (due.length === 0 && unasked.length === 0 && (questions.length === 0 || cards.length === 0))
		return null;
	return (
		<div className="grid gap-3">
			{due.map(({ account, day }) => (
				<Card key={account.id}>
					<div
						role="status"
						className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-(--card-pad)"
					>
						<div className="grid min-w-0 gap-1">
							<p className="text-sm font-semibold">
								{account.name}’s statement closed on {longDay(day)}
							</p>
							<p className="text-[13px] text-muted-foreground">
								Type its balance to check nothing’s missing.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								size="sm"
								variant="ghost"
								aria-label={`Not now: ${account.name}’s balance check`}
								disabled={!hydrated}
								onClick={() => notNow.mutate({ accountId: account.id, day })}
							>
								Not now
							</Button>
							<Button asChild size="sm" variant="outline">
								<Link to="/accounts/$accountId" params={{ accountId: account.id }}>
									Check its balance
								</Link>
							</Button>
						</div>
					</div>
				</Card>
			))}
			{unasked.map((account) => (
				<Card key={account.id}>
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-(--card-pad)">
						<div className="grid min-w-0 gap-1">
							<p className="text-sm font-semibold">
								How do purchases on {account.name} get into Noodle?
							</p>
							<p className="text-[13px] text-muted-foreground">
								From its statements, by hand, or not at all. It decides how paying the card counts.
							</p>
						</div>
						<Button asChild size="sm" variant="outline">
							<Link
								to="/accounts/$accountId"
								params={{ accountId: account.id }}
								aria-label={`Say how purchases on ${account.name} get in`}
							>
								Say how
							</Link>
						</Button>
					</div>
				</Card>
			))}
			{cards.length > 0
				? questions.map((question) => (
						<Card key={question.card}>
							<div className="grid gap-3 p-(--card-pad)">
								<div className="grid gap-1">
									<p className="text-sm font-semibold">
										Which Account is “{question.card}” in Wallet?
									</p>
									<p className="text-[13px] text-muted-foreground">
										{question.captures === 1
											? "A Wallet capture was paid with it."
											: `${question.captures} Wallet captures were paid with it.`}{" "}
										Noodle remembers your answer.
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									{cards.map((card) => (
										<Button
											key={card.id}
											type="button"
											size="sm"
											variant="outline"
											disabled={!hydrated || answer.isPending}
											onClick={() => answer.mutate({ card: question.card, accountId: card.id })}
										>
											{card.name}
										</Button>
									))}
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={!hydrated || answer.isPending || none.isPending}
										onClick={() => none.mutate(question.card)}
									>
										None of these
									</Button>
								</div>
							</div>
						</Card>
					))
				: null}
		</div>
	);
}
