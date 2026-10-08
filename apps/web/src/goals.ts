import type { AccountRecord, ArchivedAccount, GoalChange, GoalRecord } from "@noodle/db";
import {
	type AccountKind,
	accountBalance,
	type BalanceUpdate,
	type Cents,
	canPayOff,
	type DayKey,
	type GoalKind,
	type GoalProgress,
	goalProgress,
	holdsMoney,
	type LoanFacts,
	type MonthKey,
	NO_LOAN_FACTS,
	owedFor,
	owedOn,
	type PurchasesGetIn,
	splitAccount,
} from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import {
	type Mutation,
	type QueryClient,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { goalsQuery, monthQuery, monthsKey } from "./queries";
import { setCardKept } from "./server/card-kept";
import {
	addAccount,
	addGoal,
	addPaymentCommitment,
	archiveGoal,
	claimForGoal,
	completeGoal,
	fundGoal,
	type GoalsData,
	renameAccount,
	restartPayoffGoal,
	setAccountWhose,
	setEmergencyGoal,
	setLoanFacts,
	spendGoal,
	undoGoalFunding,
	updateAccountBalance,
	updateGoal,
} from "./server/goals";
import type { MonthData } from "./server/month";

export type { AccountRecord, ArchivedAccount, GoalChange, GoalRecord, GoalsData };

// ---------------------------------------------------------------------------------------------
// Views: what the Goal and Account screens show, derived from the cached records with
// @noodle/domain, so an optimistic change moves every number at once (ADR-0006).

export type GoalState = "active" | "completed" | "archived";

export type AccountView = AccountRecord & {
	/** Checking and savings hold money and can back Goals; for the others the balance is owed. */
	holdsMoney: boolean;
	/** The latest balance entered, less Goal spending since. Null until one is entered. */
	balance: Cents | null;
	/** Each non-archived Goal's set-aside money on this Account. */
	earmarks: { goal: GoalRecord; amount: Cents }[];
	earmarked: Cents;
	/** Null until the Account has a balance; negative when over-claimed. */
	unclaimed: Cents | null;
	/** How much more what Goals have set aside are than the balance, or 0. */
	overClaimedBy: Cents;
	/** A credit card or loan's active payoff Goal, if it has one (ADR-0019). */
	payoffGoal: GoalRecord | null;
};

export type GoalView = GoalRecord & {
	state: GoalState;
	account: AccountRecord | null;
	progress: GoalProgress;
	/** Every change to what it has set aside (a payoff Goal's: its funding), newest first. */
	changes: GoalChange[];
	/**
	 * A payoff Goal's card or loan: what's owed now (null without a balance), and every balance
	 * since the one before the Goal was added, newest first. Null for a savings Goal.
	 */
	payoff: {
		owed: Cents | null;
		history: BalanceUpdate[];
		/**
		 * Payments filed in Commitments that pay its card or loan down (ADR-0050) since the Goal
		 * began, newest first.
		 */
		payments: { id: string; amount: Cents; date: DayKey }[];
	} | null;
};

export type GoalsView = {
	emergencyGoalId: string | null;
	/** The Household's current month and today. */
	month: MonthKey;
	asOf: DayKey;
	accounts: AccountView[];
	/** In the order they were added. */
	goals: GoalView[];
	/** Accounts a Parent archived (ADR-0046), the latest first: listed only to be restored. */
	archivedAccounts: ArchivedAccount[];
};

export const goalState = (goal: Pick<GoalRecord, "completed" | "archived">): GoalState =>
	goal.archived ? "archived" : goal.completed ? "completed" : "active";

export function accountView(data: GoalsData, account: AccountRecord): AccountView {
	// What a card or loan owes is its own figure (owedOn, ADR-0050); only money held has Goal spending.
	const balance = holdsMoney(account.kind)
		? accountBalance(
				account.latestBalance,
				data.withdrawals.filter((w) => w.accountId === account.id),
			)
		: account.owed;
	const goals = data.goals.filter((g) => g.accountId === account.id);
	// A payoff Goal sets nothing aside (ADR-0019).
	const split = splitAccount({
		balance,
		goals: goals.filter((g) => g.kind === "save"),
		changes: data.changes,
	});
	return {
		...account,
		holdsMoney: holdsMoney(account.kind),
		balance,
		earmarks: split.earmarks.flatMap(({ goalId, amount }) => {
			const goal = goals.find((g) => g.id === goalId);
			return goal ? [{ goal, amount }] : [];
		}),
		earmarked: split.earmarked,
		unclaimed: split.unclaimed,
		overClaimedBy: split.overClaimedBy,
		payoffGoal:
			goals.find((g) => g.kind === "payoff" && !g.completed && !g.archived) ??
			// Otherwise the latest one paid off, so the Account still links to it.
			[...goals].reverse().find((g) => g.kind === "payoff" && g.completed && !g.archived) ??
			null,
	};
}

export function goalView(data: GoalsData, goal: GoalRecord): GoalView {
	const owed = owedFor(goal, data.accounts);
	return {
		...goal,
		state: goalState(goal),
		account: data.accounts.find((a) => a.id === goal.accountId) ?? null,
		progress: goalProgress({ ...goal, owed }, data.changes, data.month),
		changes: data.changes.filter((c) => c.goalId === goal.id).reverse(),
		payoff:
			goal.kind === "payoff"
				? {
						owed,
						history: owedHistory(data, goal),
						payments: data.payments
							.filter((p) => p.accountId === goal.accountId && p.date >= `${goal.fromMonth}-01`)
							.map(({ id, amount, date }) => ({ id, amount, date }))
							.reverse(),
					}
				: null,
	};
}

/**
 * What was owed on a payoff Goal's card or loan over time, newest first: every balance from the
 * last one before the Goal was added (what it started from) on.
 */
function owedHistory(data: GoalsData, goal: GoalRecord): BalanceUpdate[] {
	const points = data.owed.filter((p) => p.accountId === goal.accountId);
	// By UTC day, the same on the server and in the browser.
	const firstOfMonth = `${goal.fromMonth}-01`;
	let startsAt = 0;
	points.forEach((p, i) => {
		if (new Date(p.at).toISOString().slice(0, 10) < firstOfMonth) startsAt = i;
	});
	return points
		.slice(startsAt)
		.map(({ amount, at, day }) => ({ amount, at, ...(day ? { day } : {}) }))
		.reverse();
}

export const goalsView = (data: GoalsData): GoalsView => ({
	emergencyGoalId: data.emergencyGoalId,
	month: data.month,
	asOf: data.asOf,
	accounts: data.accounts.map((account) => accountView(data, account)),
	goals: data.goals.map((goal) => goalView(data, goal)),
	archivedAccounts: data.archivedAccounts,
});

/** Every Account and Goal, derived from the cached records. */
export const useGoals = () => useSuspenseQuery({ ...goalsQuery(), select: goalsView }).data;

/** What an Account's kind is called. */
export const accountKindName: Record<AccountKind, string> = {
	checking: "Checking",
	savings: "Savings",
	"credit-card": "Credit card",
	loan: "Loan",
};

/** A credit card or loan can be paid off with a payoff Goal. */
export { canPayOff };

/** "On track", "Behind", …; a payoff Goal that's reached is "Paid off". */
export const statusNameOf = (goal: { kind: GoalKind }, status: GoalProgress["status"]) =>
	goal.kind === "payoff" && status === "reached" ? "Paid off" : goalStatusName[status];

/** "On track", "Behind", … */
export const goalStatusName: Record<GoalProgress["status"], string> = {
	reached: "Reached",
	"on-track": "On track",
	behind: "Behind",
	"past-due": "Past due",
	saving: "Saving",
};

// ---------------------------------------------------------------------------------------------
// Changes. Each is applied to the cached records at once and rolled back if the server fails
// or refuses it.

/** Changes to Accounts and Goals alone; Goal funding and spending share `monthChangeKey`. */
export const goalChangeKey = ["goal-change"] as const;

/** Every in-flight change that edits the cached Goals records carries this in its `meta`. */
export const touchesGoals = { goals: true } as const;
const isGoalsChange = (mutation: Mutation<unknown, Error, unknown, unknown>) =>
	mutation.options.meta?.goals === true;

/** The server's guard refused the change (e.g. more than what's set aside); retrying won't help. */
export class GoalRefused extends Error {
	constructor(message = "Refused") {
		super(message);
	}
}

const refuseUnlessOk = async (result: Promise<{ ok: boolean }>) => {
	if (!(await result).ok) throw new GoalRefused();
};

/** Refetches the Goals records once no other change to them is in flight. */
export function refetchGoalsOnceSettled(queryClient: QueryClient) {
	// Refetching while another change is in flight would briefly undo it on screen.
	if (queryClient.isMutating({ predicate: isGoalsChange }) === 1) {
		return queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
	}
}

/** Refetches every month once no other change to a month is in flight. */
export function refetchMonthsOnceSettled(queryClient: QueryClient) {
	if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
		return queryClient.invalidateQueries({ queryKey: monthsKey });
	}
}

/** Applies an edit to a cached query, returning what to roll back to. */
export async function editCache<T>(
	queryClient: QueryClient,
	queryKey: readonly unknown[],
	change: (data: T) => T,
) {
	await queryClient.cancelQueries({ queryKey });
	const previous = queryClient.getQueryData<T>(queryKey);
	if (previous) queryClient.setQueryData(queryKey, change(previous));
	return { queryKey, previous };
}

export type Rollback = { queryKey: readonly unknown[]; previous: unknown }[];

export const rollBack = (queryClient: QueryClient, rollback: Rollback | undefined) => {
	for (const { queryKey, previous } of rollback ?? []) {
		if (previous) queryClient.setQueryData(queryKey, previous);
	}
};

/**
 * A change to Accounts or Goals, applied to the cached records at once and rolled back if it
 * fails or is refused (the error is then a `GoalRefused`); the returned mutation's `isError`,
 * `error` and `variables` let the caller explain it and offer a retry (`SaveFailed`).
 */
export function useGoalChange<TVariables>({
	save,
	apply,
	onSuccess,
	onError,
}: {
	save: (variables: TVariables) => Promise<unknown>;
	apply: (data: GoalsData, variables: TVariables) => GoalsData;
} & ChangeCallbacks<TVariables>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: goalChangeKey,
		meta: touchesGoals,
		mutationFn: save,
		onMutate: async (variables): Promise<Rollback> => [
			await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
				apply(data, variables),
			),
		],
		onError: (error, variables, rollback) => {
			rollBack(queryClient, rollback);
			onError?.(error, variables);
		},
		onSuccess: (_data, variables) => onSuccess?.(variables),
		onSettled: () => refetchGoalsOnceSettled(queryClient),
	});
}

/** Called once a change is saved, or has failed, even if its caller has since unmounted. */
export type ChangeCallbacks<TVariables> = {
	onSuccess?: (variables: TVariables) => void;
	onError?: (error: Error, variables: TVariables) => void;
};

// The optimistic edits, mirroring what each server function records. `at` stands in for the
// server's time until the refetch.

export type AddAccountVariables = {
	accountId: string;
	name: string;
	kind: AccountKind;
	balanceCents: Cents | null;
	balanceId: string;
	/** For a credit card: how its purchases get into Noodle. */
	purchases?: PurchasesGetIn | null;
	/** Whose it is: a Parent, or null for the Household's. Left out: the Parent adding it. */
	whoseMemberId?: string | null;
	/** For a loan: what was borrowed, the payment, its due day and the day it ends. */
	loan?: LoanFacts;
	/** "Add a monthly Commitment for its payments", left on: what one is and the day it is due. */
	commitment?: PaymentCommitmentVariables;
};

/** A monthly Commitment for an Account's payments (issue 153). */
export type PaymentCommitmentVariables = {
	commitmentId: string;
	amountCents: Cents;
	/** The day of the month it is due, 1 to 31. */
	dueDay: number;
};

export const withAccount = (data: GoalsData, v: AddAccountVariables): GoalsData =>
	data.accounts.some((a) => a.id === v.accountId)
		? data
		: {
				...data,
				accounts: [
					...data.accounts,
					{
						id: v.accountId,
						name: v.name,
						mask: null,
						kind: v.kind,
						bankConnectionId: null,
						lastStatementDate: null,
						purchases: v.kind === "credit-card" ? (v.purchases ?? null) : null,
						walletName: null,
						statementDay: null,
						whose: v.whoseMemberId ?? null,
						...(v.kind === "loan" ? { loan: v.loan ?? NO_LOAN_FACTS } : {}),
						latestBalance:
							v.balanceCents === null
								? null
								: { amount: v.balanceCents, at: Date.now(), day: data.asOf },
						owed: canPayOff(v.kind) ? v.balanceCents : null,
					},
				],
			};

export const withAccountName = (
	data: GoalsData,
	{ accountId, name }: { accountId: string; name: string },
): GoalsData => ({
	...data,
	accounts: data.accounts.map((a) => (a.id === accountId ? { ...a, name } : a)),
});

export type BalanceVariables = {
	balanceId: string;
	accountId: string;
	amountCents: Cents;
	/** The day the balance was true: a statement's closing date. Today when left out. */
	asOf?: DayKey;
};

export const withBalance = (data: GoalsData, v: BalanceVariables): GoalsData => {
	const at = Date.now();
	const account = data.accounts.find((a) => a.id === v.accountId);
	return {
		...data,
		accounts: data.accounts.map((a) => {
			if (a.id !== v.accountId) return a;
			const day = v.asOf ?? data.asOf;
			return {
				...a,
				latestBalance: { amount: v.amountCents, at, day },
				// As the server will have it: payments made after the balance's day still come off.
				owed: canPayOff(a.kind)
					? owedOn(
							{ amount: v.amountCents, day },
							[
								...data.payments,
								// A Transfer naming a card kept by hand comes off too.
								...(data.sent ?? []).filter((p) => p.comesOff),
							].filter((p) => p.accountId === a.id),
							a.bankConnectionId !== null,
						)
					: null,
			};
		}),
		owed:
			account && canPayOff(account.kind)
				? [...data.owed, { accountId: v.accountId, amount: v.amountCents, at }]
				: data.owed,
	};
};

export type AddGoalVariables = {
	goalId: string;
	/** A payoff Goal's target is what's owed now; the server reads it again (ADR-0019). */
	kind: GoalKind;
	accountId: string;
	name: string;
	targetCents: Cents;
	targetDate: DayKey | null;
	claimId: string;
	/** not set aside money already set aside for it; 0 for none. */
	claimCents: Cents;
};

export const withGoal = (data: GoalsData, v: AddGoalVariables): GoalsData =>
	data.goals.some((g) => g.id === v.goalId)
		? data
		: {
				...data,
				goals: [
					...data.goals,
					{
						id: v.goalId,
						kind: v.kind,
						accountId: v.accountId,
						name: v.name,
						target: v.targetCents,
						targetDate: v.targetDate,
						fromMonth: data.month,
						completed: false,
						completedAt: null,
						archived: false,
					},
				],
				changes:
					v.claimCents > 0
						? [
								...data.changes,
								{
									id: v.claimId,
									goalId: v.goalId,
									kind: "claim",
									amount: v.claimCents,
									month: data.month,
								},
							]
						: data.changes,
			};

export type UpdateGoalVariables = {
	goalId: string;
	name: string;
	targetCents: Cents;
	targetDate: DayKey | null;
};

const mapGoal = (data: GoalsData, goalId: string, change: (g: GoalRecord) => GoalRecord) => ({
	...data,
	goals: data.goals.map((g) => (g.id === goalId ? change(g) : g)),
});

export const withGoalDetails = (data: GoalsData, v: UpdateGoalVariables): GoalsData =>
	mapGoal(data, v.goalId, (g) => ({
		...g,
		name: v.name,
		// A payoff Goal's target stays what was owed (ADR-0019).
		target: g.kind === "payoff" ? g.target : v.targetCents,
		targetDate: v.targetDate,
	}));

export const withGoalCompleted = (data: GoalsData, { goalId }: { goalId: string }) =>
	mapGoal(data, goalId, (g) =>
		g.archived ? g : { ...g, completed: true, completedAt: Date.now() },
	);

export const withGoalArchived = (data: GoalsData, { goalId }: { goalId: string }) =>
	mapGoal(data, goalId, (g) => ({ ...g, archived: true }));

/** Appends money set aside change; the same one twice changes nothing. */
export const withChange = (data: GoalsData, change: GoalChange): GoalsData =>
	data.changes.some((c) => c.id === change.id)
		? data
		: { ...data, changes: [...data.changes, change] };

export const withoutChange = (data: GoalsData, id: string): GoalsData => ({
	...data,
	changes: data.changes.filter((c) => c.id !== id),
});

export type ClaimVariables = {
	claimId: string;
	goalId: string;
	/** Positive sets not set aside money aside; negative releases some of what's set aside. */
	amountCents: Cents;
};

export const withClaim = (data: GoalsData, v: ClaimVariables) =>
	withChange(data, {
		id: v.claimId,
		goalId: v.goalId,
		kind: "claim",
		amount: v.amountCents,
		month: data.month,
	});

// Account and Goal changes, one hook each, for forms that show `SaveFailed`.

export const useAddAccount = () => {
	const queryClient = useQueryClient();
	return useGoalChange({
		save: (data: AddAccountVariables) => addAccount({ data }),
		apply: withAccount,
		// Its Commitment is in the Plan from this month: every month's Commitments are read again.
		onSuccess: (account) => {
			if (!account.commitment) return;
			void queryClient.invalidateQueries({ queryKey: monthsKey });
			toast(`${account.name}’s payments are a Commitment in the Plan now.`);
		},
	});
};

export type LoanFactsVariables = LoanFacts & { accountId: string };

export const withLoanFacts = (
	data: GoalsData,
	{ accountId, ...loan }: LoanFactsVariables,
): GoalsData => ({
	...data,
	accounts: data.accounts.map((a) =>
		a.id === accountId && a.kind === "loan" ? { ...a, loan } : a,
	),
});

/** Records a loan's facts: what was borrowed, the payment, its due day and the day it ends. */
export const useSetLoanFacts = () =>
	useGoalChange({
		save: (data: LoanFactsVariables) => refuseUnlessOk(setLoanFacts({ data })),
		apply: withLoanFacts,
	});

/**
 * Adds a monthly Commitment for the payments of a loan or card the Household has already. For a
 * loan the payment and its due day become its facts too, as the server records them.
 */
export const useAddPaymentCommitment = (callbacks: ChangeCallbacks<PaymentCommitmentVariables>) => {
	const queryClient = useQueryClient();
	return useGoalChange({
		save: (data: PaymentCommitmentVariables & { accountId: string }) =>
			refuseUnlessOk(addPaymentCommitment({ data })),
		apply: (data, v) => ({
			...data,
			accounts: data.accounts.map((a) =>
				a.id === v.accountId && a.kind === "loan"
					? {
							...a,
							loan: { ...(a.loan ?? NO_LOAN_FACTS), payment: v.amountCents, dueDay: v.dueDay },
						}
					: a,
			),
		}),
		onSuccess: (variables) => {
			void queryClient.invalidateQueries({ queryKey: monthsKey });
			callbacks.onSuccess?.(variables);
		},
		onError: callbacks.onError,
	});
};

export type CardKeptVariables = {
	accountId: string;
	purchases: PurchasesGetIn;
	/** The day of the month its statement closes; left as it is when not given. */
	statementDay?: number | null;
};

export const withCardKept = (data: GoalsData, v: CardKeptVariables): GoalsData => ({
	...data,
	accounts: data.accounts.map((a) =>
		a.id === v.accountId
			? {
					...a,
					purchases: v.purchases,
					statementDay: v.statementDay === undefined ? a.statementDay : v.statementDay,
				}
			: a,
	),
});

/** Says how a card's purchases get into Noodle, and when its statement closes. */
export const useSetCardKept = () =>
	useGoalChange({
		save: (data: CardKeptVariables) => refuseUnlessOk(setCardKept({ data })),
		apply: withCardKept,
	});

export const useRenameAccount = () =>
	useGoalChange({
		save: (data: { accountId: string; name: string }) => renameAccount({ data }),
		apply: withAccountName,
	});

export const withAccountWhose = (
	data: GoalsData,
	{ accountId, whoseMemberId }: { accountId: string; whoseMemberId: string | null },
): GoalsData => ({
	...data,
	accounts: data.accounts.map((a) => (a.id === accountId ? { ...a, whose: whoseMemberId } : a)),
});

/** Says whose an Account is: a Parent's, or the Household's (null). */
export const useSetAccountWhose = () =>
	useGoalChange({
		save: (data: { accountId: string; whoseMemberId: string | null }) =>
			refuseUnlessOk(setAccountWhose({ data })),
		apply: withAccountWhose,
	});

export const useUpdateAccountBalance = () =>
	useGoalChange({
		save: (data: BalanceVariables) => refuseUnlessOk(updateAccountBalance({ data })),
		apply: withBalance,
	});

export const useAddGoal = (callbacks: ChangeCallbacks<AddGoalVariables> = {}) =>
	useGoalChange({
		save: (data: AddGoalVariables) => refuseUnlessOk(addGoal({ data })),
		apply: withGoal,
		...callbacks,
	});

/** Starts a payoff Goal again from what's owed now, with its schedule from this month. */
export const useRestartPayoffGoal = () =>
	useGoalChange({
		save: (data: { goalId: string }) => refuseUnlessOk(restartPayoffGoal({ data })),
		apply: (data, { goalId }): GoalsData => {
			const goal = data.goals.find((g) => g.id === goalId);
			const owed = goal ? owedFor(goal, data.accounts) : null;
			return owed === null || owed <= 0
				? data
				: mapGoal(data, goalId, (g) => ({ ...g, target: owed, fromMonth: data.month }));
		},
	});

export const useUpdateGoal = () =>
	useGoalChange({
		save: (data: UpdateGoalVariables) => updateGoal({ data }),
		apply: withGoalDetails,
	});

export const useCompleteGoal = () =>
	useGoalChange({
		save: (data: { goalId: string }) => completeGoal({ data }),
		apply: withGoalCompleted,
	});

export const useArchiveGoal = () =>
	useGoalChange({
		save: (data: { goalId: string }) => archiveGoal({ data }),
		apply: withGoalArchived,
	});

/** Marks a Goal as the Household's emergency Goal, or clears it (null). */
export const useSetEmergencyGoal = () =>
	useGoalChange({
		save: (data: { goalId: string | null }) => refuseUnlessOk(setEmergencyGoal({ data })),
		apply: (data, { goalId }): GoalsData => ({ ...data, emergencyGoalId: goalId }),
	});

/** Sets not set aside money aside for a Goal, or releases some back; refused beyond what it has set aside. */
export const useClaimForGoal = () =>
	useGoalChange({
		save: (data: ClaimVariables) => refuseUnlessOk(claimForGoal({ data })),
		apply: withClaim,
	});

// ---------------------------------------------------------------------------------------------
// Goal funding and Goal spending: these change a month too, so they share `monthChangeKey`,
// and say how they went in a toast (their sheets have closed by then).

export type FundGoalVariables = {
	/** A client ULID: retrying the same funding records it once. */
	moveId: string;
	goalId: string;
	goalName: string;
	/** The Household's current month, whose Free to Spend it comes out of. */
	month: MonthKey;
	amountCents: Cents;
};

export type UndoFundingVariables = Pick<FundGoalVariables, "moveId" | "goalName" | "month">;

export type SpendGoalVariables = {
	/** A client ULID: retrying the same spending records it once. */
	transactionId: string;
	goalId: string;
	goalName: string;
	accountId: string;
	/** The Household's current month and today, where the Transaction lands. */
	month: MonthKey;
	date: DayKey;
	amountCents: Cents;
	note: string | null;
};

/** Refused funding: Free to Spend had less than the amount, or the Goal isn't active now. */
class FundingRefused extends GoalRefused {
	constructor(readonly freeToSpend: Cents) {
		super("Not enough Free to Spend");
	}
}

export const withFunding = (data: GoalsData, v: FundGoalVariables) =>
	withChange(data, {
		id: v.moveId,
		goalId: v.goalId,
		kind: "funding",
		amount: v.amountCents,
		month: v.month,
	});

/** A month's inputs with Goal funding in them, so its Free to Spend drops at once. */
export const withMonthFunding = (data: MonthData, v: FundGoalVariables): MonthData =>
	data.goalFunding.some((f) => f.id === v.moveId)
		? data
		: {
				...data,
				goalFunding: [
					...data.goalFunding,
					{ id: v.moveId, goalId: v.goalId, amount: v.amountCents, month: v.month },
				],
			};

export const withoutMonthFunding = (data: MonthData, { moveId }: { moveId: string }) => ({
	...data,
	goalFunding: data.goalFunding.filter((f) => f.id !== moveId),
});

export const withSpending = (data: GoalsData, v: SpendGoalVariables): GoalsData => {
	if (data.changes.some((c) => c.id === v.transactionId)) return data;
	return {
		...withChange(data, {
			id: v.transactionId,
			goalId: v.goalId,
			kind: "spending",
			amount: -v.amountCents,
			month: v.month,
			date: v.date,
			note: v.note,
		}),
		withdrawals: [
			...data.withdrawals,
			{ accountId: v.accountId, amount: v.amountCents, at: Date.now() },
		],
	};
};

/**
 * Goal funding (a Move from this month's Free to Spend into what a Goal has set aside), undoing it, and
 * Goal spending (a Transaction out of what's set aside, never a Bucket). Each lands in the cached
 * Goals records, and funding in the month's inputs too, at once; each rolls back if the server
 * fails or refuses it. Funding's toast offers Undo; a failure's offers Retry.
 */
export function useGoalMoney() {
	const queryClient = useQueryClient();

	function onSettled() {
		return Promise.all([
			refetchGoalsOnceSettled(queryClient),
			refetchMonthsOnceSettled(queryClient),
		]);
	}

	const undo = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ moveId, month }: UndoFundingVariables) => {
			const result = await undoGoalFunding({ data: { moveId, month } });
			if (!result.ok) throw new GoalRefused();
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
				withoutChange(data, v.moveId),
			),
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withoutMonthFunding(data, v),
			),
		],
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof GoalRefused) {
				toast(
					`Some of what ${v.goalName} has set aside is already spent or released, so it can’t be undone.`,
					{
						tone: "error",
					},
				);
			} else {
				toast(`Couldn’t undo funding ${v.goalName}, so it’s still funded.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => undo.mutate(v) },
				});
			}
		},
		onSuccess: () => toast("Undone: the money is back in Free to Spend"),
		onSettled,
	});

	const fund = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ moveId, goalId, month, amountCents }: FundGoalVariables) => {
			const outcome = await fundGoal({ data: { moveId, goalId, month, amountCents } });
			if (!outcome.ok) throw new FundingRefused(outcome.freeToSpend);
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
				withFunding(data, v),
			),
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withMonthFunding(data, v),
			),
		],
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof FundingRefused) {
				toast(
					error.freeToSpend < v.amountCents
						? `Free to Spend has only ${formatMoney(error.freeToSpend)} left, so ${v.goalName} wasn’t funded.`
						: `${v.goalName} can’t be funded now.`,
					{ tone: "error" },
				);
			} else {
				toast(`Couldn’t fund ${v.goalName}, so it’s been undone.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => fund.mutate(v) },
				});
			}
		},
		onSuccess: (_data, v) => {
			toast(`${formatMoney(v.amountCents)} from Free to Spend to ${v.goalName}`, {
				tone: "success",
				undo: () => undo.mutate(v),
			});
		},
		onSettled,
	});

	const spend = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ transactionId, goalId, amountCents, note }: SpendGoalVariables) => {
			const result = await spendGoal({
				data: { transactionId, goalId, amountCents, note: note ?? undefined },
			});
			if (!result.ok) throw new GoalRefused();
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
				withSpending(data, v),
			),
		],
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof GoalRefused) {
				toast(`That’s more than ${v.goalName} has saved, so it wasn’t recorded.`, {
					tone: "error",
				});
			} else {
				toast(`Couldn’t record spending from ${v.goalName}, so it’s been undone.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => spend.mutate(v) },
				});
			}
		},
		onSuccess: (_data, v) => {
			toast(`${formatMoney(v.amountCents)} spent from ${v.goalName}`, { tone: "success" });
		},
		onSettled,
	});

	return { fund, undo, spend };
}
