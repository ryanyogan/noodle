import { MONEY_IN_KIND_LABELS, type MoneyInKind, type MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { monthQuery, monthsKey, reviewQuery, rulesQuery } from "./queries";
import {
	getMoneyIn,
	getMoneyInAccounts,
	getMoneyInReview,
	getMoneyInRules,
	type MoneyInLine,
	rememberMoneyInPair,
	removeMoneyInRule,
	setMoneyInKind,
} from "./server/money-in";

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
					expectedVersion: line.version,
					ruleId: always ? ulid() : undefined,
				},
			});
			if (!result.ok) throw new KindRefused(result.reason);
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
