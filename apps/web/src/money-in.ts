import { MONEY_IN_KIND_LABELS, type MoneyInKind, type MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { monthQuery, monthsKey, reviewQuery, rulesQuery } from "./queries";
import { reviewWrites } from "./review-stack";
import {
	alwaysWhosePay,
	editMoneyInLine,
	getMoneyIn,
	getMoneyInAccounts,
	getMoneyInReview,
	getMoneyInRules,
	getPayRanges,
	type MoneyInLine,
	rememberMoneyInPair,
	removeMoneyInRule,
	setMoneyInKind,
} from "./server/money-in";
import { ChangedElsewhere, expectedVersionOf, noteVersion } from "./transaction-versions";

export type { MoneyInLine } from "./server/money-in";

// Money in and its kind (issue 131, ADR-0057). Both reads sit under the months' key, so anything
// that refetches a month (an Import, the other Parent's write) refetches them.

/** A month's money in, of every kind, newest first. */
export const moneyInQuery = (month: MonthKey) =>
	queryOptions({
		queryKey: [...monthQuery(month).queryKey, "money-in"],
		queryFn: () => getMoneyIn({ data: { month } }),
	});

/** The money in waiting in Review. */
export const moneyInReviewQuery = () =>
	queryOptions({
		queryKey: [...reviewQuery().queryKey, "money-in"],
		queryFn: () => getMoneyInReview(),
	});

/** What a money-in line is called where it is listed: the bank's wording, or what a Parent wrote. */
export const moneyInLabel = (line: Pick<MoneyInLine, "note">) => line.note?.trim() || "Money in";

/** The kind as the app says it; a line waiting in Review has none yet. */
export const moneyInKindText = (line: Pick<MoneyInLine, "kind" | "needsReview">) =>
	line.needsReview ? "Needs review" : MONEY_IN_KIND_LABELS[line.kind];

class KindRefused extends Error {
	constructor(readonly reason: "refused" | "extra-income" | "changed-elsewhere") {
		super(reason);
	}
}

export type MoneyInKindChange = {
	line: MoneyInLine;
	kind: MoneyInKind;
	/** Also state a Rule: money in with this wording is always this kind. */
	always?: boolean;
};

/** A Parent says what kind a money-in line is. The lists are refetched once it is written. */
export function useMoneyInKindChange() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async ({ line, kind, always }: MoneyInKindChange) => {
			const result = await setMoneyInKind({
				data: {
					incomeId: line.id,
					kind,
					transferId: ulid(),
					// The version this screen's own earlier change to the line gave, if any.
					expectedVersion: expectedVersionOf(line),
					ruleId: always ? ulid() : undefined,
				},
			});
			if (!result.ok) throw new KindRefused(result.reason);
			noteVersion(line.id, result.line.version);
			return result.line;
		},
		onError: (error) => {
			const reason = error instanceof KindRefused ? error.reason : null;
			toast(
				reason === "extra-income"
					? "Some of this month’s Extra income has gone somewhere already, so this stays Income."
					: reason === "changed-elsewhere"
						? "This was changed on another screen. Here’s how it looks now."
						: "Couldn’t change it, so it’s as it was.",
				{ tone: "error" },
			);
		},
		onSuccess: (line, { always }) =>
			toast(
				`${formatMoney(line.amount)} is ${MONEY_IN_KIND_LABELS[line.kind]}${always ? ", and so is money like it from now on" : ""}`,
				{ tone: "success" },
			),
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}

/**
 * How many lines wait in Review, for its badges: Transactions to file and money in a Parent
 * hasn't named yet.
 */
export function useReviewWaiting(): number {
	const filing = useQuery(reviewQuery()).data?.total ?? 0;
	const moneyIn = useQuery(moneyInReviewQuery()).data?.length ?? 0;
	return filing + moneyIn;
}

/** The Household's Rules for money in; under the Rules' key, so a change to Rules refetches it. */
export const moneyInRulesQuery = () =>
	queryOptions({
		queryKey: [...rulesQuery().queryKey, "money-in"],
		queryFn: () => getMoneyInRules(),
	});

/** The Household's Accounts by name, to say which one money came from. */
export const moneyInAccountsQuery = () =>
	queryOptions({
		queryKey: ["money-in-accounts"],
		queryFn: () => getMoneyInAccounts(),
	});

/** A Transfer seen from one side only, into an Account: a Parent may say which Account it came from. */
export const pairOffered = (
	line: Pick<
		MoneyInLine,
		"kind" | "needsReview" | "paired" | "accountId" | "note" | "otherAccountId"
	>,
) =>
	!line.needsReview &&
	line.kind === "transfer" &&
	!line.paired &&
	!line.otherAccountId &&
	!!line.accountId &&
	!!line.note?.trim();

/** A Parent says a Transfer came from another Account, and that money like it always does. */
export function useRememberAccountPair() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { line: MoneyInLine; otherAccountId: string; names: string }) => {
			const result = await rememberMoneyInPair({
				data: { incomeId: input.line.id, otherAccountId: input.otherAccountId, ruleId: ulid() },
			});
			if (!result.ok) throw new Error(result.reason);
		},
		onError: () => toast("Couldn’t remember that, so nothing changed.", { tone: "error" }),
		onSuccess: (_, { names }) =>
			toast(`Money ${names} is always a Transfer now`, { tone: "success" }),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: monthsKey }),
				queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
			]),
	});
}

/** Removes a Rule for money in. */
export function useRemoveMoneyInRule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (ruleId: string) => removeMoneyInRule({ data: { ruleId } }),
		onError: () => toast("Couldn’t remove the Rule, so it’s still there.", { tone: "error" }),
		onSuccess: () => toast("Rule removed. What it decided stays as it is.", { tone: "success" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
	});
}

/** Each Parent's pay in a month and its range over the three full months before (issue 133). */
export const payRangesQuery = (month: MonthKey) =>
	queryOptions({
		queryKey: [...monthQuery(month).queryKey, "pay-ranges"],
		queryFn: () => getPayRanges({ data: { month } }),
	});

/** What a Parent may change on a money-in line besides its kind; only what is given changes. */
export type MoneyInEdit = {
	/** A Parent's ID, or null for the Household. */
	whosePay?: string | null;
	note?: string | null;
	amountCents?: number;
	date?: string;
};

export type MoneyInEditChange = { line: MoneyInLine; edit: MoneyInEdit; month: MonthKey };

/**
 * Sends one edit of a money-in line, on the version this screen has for it (ADR-0041). Also how
 * one left waiting by an earlier page is sent again (waiting-writes.ts, ADR-0056).
 */
export async function sendMoneyInEdit({ line, edit }: MoneyInEditChange): Promise<MoneyInLine> {
	const result = await editMoneyInLine({
		data: { incomeId: line.id, expectedVersion: expectedVersionOf(line), edit },
	});
	if (!result.ok) {
		if (result.reason === "changed-elsewhere") throw new ChangedElsewhere(line.id, result.current);
		throw new KindRefused(result.reason);
	}
	noteVersion(line.id, result.line.version);
	return result.line;
}

/**
 * A Parent changes whose pay a money-in line is, its note, or (typed in by hand) its amount or
 * date. It shows in the month's money in at once; it waits its turn with the other edits and is
 * written down until answered, like a Transaction's (ADR-0041, ADR-0056).
 */
export function useMoneyInEdit() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		meta: { outbox: "money-in-edit" },
		mutationFn: sendMoneyInEdit,
		onMutate: async ({ line, edit, month }) => {
			const { queryKey } = moneyInQuery(month);
			await queryClient.cancelQueries({ queryKey });
			const before = queryClient.getQueryData(queryKey);
			queryClient.setQueryData(queryKey, (lines) =>
				lines?.map((row) =>
					row.id === line.id
						? {
								...row,
								...(edit.whosePay !== undefined ? { whosePay: edit.whosePay } : {}),
								...(edit.note !== undefined ? { note: edit.note } : {}),
								...(edit.amountCents !== undefined
									? { amount: edit.amountCents as MoneyInLine["amount"] }
									: {}),
								...(edit.date !== undefined ? { date: edit.date as MoneyInLine["date"] } : {}),
							}
						: row,
				),
			);
			return { rollback: () => queryClient.setQueryData(queryKey, before) };
		},
		onError: (error, _variables, context) => {
			context?.rollback();
			const reason = error instanceof KindRefused ? error.reason : null;
			toast(
				error instanceof ChangedElsewhere
					? "This was changed on another screen. Here’s how it looks now."
					: reason === "extra-income"
						? "Some of this month’s Extra income has gone somewhere already, so this Income stays as it is."
						: "Couldn’t save your change, so it’s as it was.",
				{ tone: "error" },
			);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}

/** States "Always treat deposits from <name> as <Parent>'s pay" from a line. Sent once. */
export function useAlwaysWhosePay() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ line, payMemberId }: { line: MoneyInLine; payMemberId: string | null }) =>
			alwaysWhosePay({ data: { ruleId: ulid(), incomeId: line.id, payMemberId } }),
		onError: () => toast("Couldn’t save that Rule, so nothing changed.", { tone: "error" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}
