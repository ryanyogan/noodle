import type { CommitmentCharge, CommitmentLinkResult } from "@noodle/db";
import {
	type AboutAmount,
	type AccountKind,
	aboutAmount,
	aboutCameIn,
	addMonths,
	byNextDue,
	type Cadence,
	type Cents,
	type CommitmentState,
	type CommitmentTerms,
	type DayKey,
	type MonthKey,
	monthlyEquivalent,
	monthOfDay,
	type PlanCommitment,
	type PlanScope,
	paymentsView,
	yearlyCost,
} from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, formatWholeMoney, monthName, shortDay } from "./format";
import { monthChangeKey } from "./plan-changes";
import { commitmentsQuery, monthQuery, monthsKey } from "./queries";
import { addCommitmentPayment } from "./server/commitments";
import type { MonthData } from "./server/month";

export const cadenceNames: Record<Cadence, string> = {
	monthly: "Monthly",
	biweekly: "Every two weeks",
	annual: "Yearly",
};

const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** "Monthly · due Sep 1", "Every two weeks · due Oct 2, 16, and 30", "Yearly · due Mar 1". */
export function schedule(
	commitment: Pick<CommitmentState, "cadence" | "dueDate" | "dueDates">,
	month: MonthKey,
): string {
	const cadence = cadenceNames[commitment.cadence];
	const [first, ...rest] = commitment.dueDates;
	if (!first) return `${cadence} · due ${shortDay(commitment.dueDate)}, not in ${monthName(month)}`;
	const days = [shortDay(first), ...rest.map((day) => String(Number(day.slice(8, 10))))];
	return `${cadence} · due ${list.format(days)}`;
}

/** "$1,140 a year · $95 a month"; a monthly Commitment's month is its amount, so just "$30,000 a year". */
export function costText(terms: Pick<CommitmentTerms, "amount" | "cadence">): string {
	const year = `${formatMoney(yearlyCost(terms))} a year`;
	return terms.cadence === "monthly"
		? year
		: `${year} · ${formatMoney(monthlyEquivalent(terms))} a month`;
}

const ordinal = (day: number) => {
	const suffix =
		day % 10 === 1 && day !== 11
			? "st"
			: day % 10 === 2 && day !== 12
				? "nd"
				: day % 10 === 3 && day !== 13
					? "rd"
					: "th";
	return `${day}${suffix}`;
};

/** "Monthly, due on the 1st", "Every two weeks from Sep 4", "Yearly, due Mar 15". */
export function termsSchedule(terms: Pick<CommitmentTerms, "cadence" | "dueDate">): string {
	switch (terms.cadence) {
		case "monthly":
			return `Monthly, due on the ${ordinal(Number(terms.dueDate.slice(8, 10)))}`;
		case "biweekly":
			return `Every two weeks from ${shortDay(terms.dueDate)}`;
		case "annual":
			return `Yearly, due ${shortDay(terms.dueDate)}`;
	}
}

/**
 * "About $160 · $120–$210": an "about" Commitment's amount (issue 135), the average of its charges
 * and how far they range, in whole dollars. Before its first charge, and with a single amount so
 * far, just "About $160" (what the Plan sets aside, until there is a charge).
 */
export function aboutText(about: AboutAmount | null, planned: Cents): string {
	if (!about) return `About ${formatWholeMoney(planned)}`;
	const average = `About ${formatWholeMoney(about.average)}`;
	return about.low === about.high
		? average
		: `${average} · ${formatWholeMoney(about.low)}–${formatWholeMoney(about.high)}`;
}

/**
 * "Power came in $35 over · comes out of what carries to November" (or "under · adds to"): an
 * "about" Commitment whose charges for `month` are all in and aren't what the Plan set aside.
 * This month's Free to Spend doesn't move; the difference is in what carries over (ADR-0054).
 * Null for any other Commitment (aboutCameIn).
 */
export function carryNote(
	commitment: Pick<CommitmentState, "name" | "about" | "charges" | "dueDates" | "difference">,
	month: MonthKey,
): string | null {
	const cameIn = aboutCameIn(commitment);
	if (cameIn === null) return null;
	const next = monthName(addMonths(month, 1));
	return cameIn > 0
		? `${commitment.name} came in ${formatMoney(cameIn)} over · comes out of what carries to ${next}`
		: `${commitment.name} came in ${formatMoney(-cameIn)} under · adds to what carries to ${next}`;
}

/**
 * An "about" Commitment's amount as of today, from its charges over the last year (the same read
 * Coming up makes). Null for one that's the same each time, before the charges have loaded, and
 * before its first charge.
 */
export function useAboutAmount(commitment: { id: string; about?: boolean | undefined }) {
	const { data } = useQuery({ ...commitmentsQuery(), enabled: commitment.about === true });
	if (!commitment.about || !data) return null;
	return aboutAmount(
		data.charges.filter((charge) => charge.commitmentId === commitment.id),
		data.asOf,
	);
}

/** What a Parent enters for a Commitment; a Commitment's terms are set from `month` onward. */
export type CommitmentVariables = {
	/** A client ULID: retrying the same add creates the Commitment once. */
	commitmentId: string;
	month: MonthKey;
	name: string;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
	/** Its amount is "about" (it varies) or the same each time; left out, it stays as it is. */
	about?: boolean | undefined;
	/** How far a change to its terms reaches; from `month` on when left out. */
	scope?: PlanScope;
	/** What it pays down, when that is being set or changed; left out, it stays as it is. */
	paysDown?: PaysDown;
};

/** The credit card or loan a Commitment pays down (null for none), and the "carrying" tick. */
export type PaysDown = { accountId: string | null; carriedBalance: boolean };

/** What it pays down once `v` is saved: as asked, else as it was. */
const linkOf = (v: CommitmentVariables, was?: PlanCommitment) => {
	const accountId = v.paysDown === undefined ? was?.accountId : v.paysDown.accountId;
	if (!accountId) return {};
	const carried = v.paysDown === undefined ? was?.carriedBalance : v.paysDown.carriedBalance;
	return { accountId, carriedBalance: carried ?? false };
};

const toPlanCommitment = (v: CommitmentVariables, was?: PlanCommitment): PlanCommitment => ({
	id: v.commitmentId,
	name: v.name,
	amount: v.amountCents,
	cadence: v.cadence,
	dueDate: v.dueDate,
	...linkOf(v, was),
	...((v.about ?? was?.about) ? { about: true } : {}),
});

/** A card or loan a Commitment could pay down, as the "Pays down" choice shows it. */
export type PaysDownAccount = {
	id: string;
	name: string;
	kind: AccountKind;
	/** What's owed now; null without a balance. */
	owed: Cents | null;
	/** It syncs with its bank, which keeps what's owed up to date. */
	connected: boolean;
	/** A card whose purchases Noodle already counts in Buckets (ADR-0050). */
	followed: boolean;
};

/** The Household's credit cards and loans in use, with the cards Noodle follows marked. */
export function paysDownAccounts(
	accounts: readonly {
		id: string;
		name: string;
		kind: AccountKind;
		bankConnectionId: string | null;
		owed: Cents | null;
	}[],
	followedCards: readonly string[],
): PaysDownAccount[] {
	return accounts
		.filter((account) => account.kind === "credit-card" || account.kind === "loan")
		.map((account) => ({
			id: account.id,
			name: account.name,
			kind: account.kind,
			owed: account.owed,
			connected: account.bankConnectionId !== null,
			followed:
				account.kind === "credit-card" &&
				(account.bankConnectionId !== null || followedCards.includes(account.id)),
		}));
}

/** A card Noodle follows is paid down only as a set payment on a balance being carried. */
export const needsCarriedTick = (account: Pick<PaysDownAccount, "kind" | "followed">) =>
	account.kind === "credit-card" && account.followed;

/** The line under "Pays down": what choosing this card or loan (or nothing yet) means. */
export function paysDownHint(account: PaysDownAccount | null): string {
	if (account === null) return "Pick a card or loan and each payment brings what’s owed down.";
	if (account.kind === "loan") {
		return account.connected
			? `Each payment counts toward ${account.name}. Its bank keeps what’s owed up to date.`
			: `Each payment brings what’s owed on ${account.name} down.`;
	}
	return account.followed
		? `Noodle already counts what you buy on ${account.name} in your Buckets. Paying it off is a Transfer, so it isn’t counted twice.`
		: `Noodle can’t see what’s bought on ${account.name}, so these payments are the spending.`;
}

/**
 * What a Commitment form says about "Pays down" (PaysDownField's inputs). `paysDown` is there only
 * when the choice differs from what the Commitment had (`was`), so saving something else never
 * asks the server to judge a link that's already in place; `needsTick` when that new choice is a
 * card Noodle follows without "a balance I'm carrying"; `busy` while a card or loan added in the
 * form is still saving. A form without the field (no card or loan yet) changes nothing.
 */
export function readPaysDown(
	values: FormData,
	was?: { accountId?: string | null | undefined; carriedBalance?: boolean | undefined },
): { paysDown?: PaysDown; needsTick: boolean; busy: boolean } {
	const busy = values.has("paysDownBusy");
	if (!values.has("paysDown")) return { needsTick: false, busy };
	const accountId = String(values.get("paysDown") ?? "") || null;
	const tick = values.get("paysDownTick");
	const carriedBalance = accountId !== null && tick === "ticked";
	const wasCarried = accountId !== null && (was?.carriedBalance ?? false);
	if (accountId === (was?.accountId ?? null) && carriedBalance === wasCarried) {
		return { needsTick: false, busy };
	}
	return {
		paysDown: { accountId, carriedBalance },
		needsTick: accountId !== null && tick === "needed",
		busy,
	};
}

type LinkRefusal = Extract<CommitmentLinkResult, { ok: false }>["reason"];

/** Why a Commitment was saved without the card or loan it was meant to pay down. */
export function paysDownRefusal(reason: LinkRefusal, commitmentName: string): string {
	switch (reason) {
		case "wrong-kind":
			return `${commitmentName} was saved, but a Commitment can only pay down a credit card or loan, so it pays nothing down.`;
		case "archived":
			return `${commitmentName} was saved, but that Account is archived, so it pays nothing down. Restore the Account, or pick another.`;
		case "followed":
			return `${commitmentName} was saved, but Noodle already counts what’s bought on that card, so paying it is a Transfer. Tick “This is a set payment on a balance I’m carrying” to have it pay the card down.`;
		case "not-found":
			return `${commitmentName} was saved, but that Account is gone, so it pays nothing down.`;
	}
}

/** Waits for a Commitment's save and says so when the card or loan it pays down was refused. */
export async function tellPaysDownRefusal(
	saved: Promise<{ paysDown: CommitmentLinkResult | null }>,
	commitmentName: string,
): Promise<void> {
	const { paysDown } = await saved;
	if (paysDown && !paysDown.ok) {
		toast(paysDownRefusal(paysDown.reason, commitmentName), { tone: "error" });
	}
}

// The optimistic edits, mirroring what each server function records.

const mapCommitments = (data: MonthData, change: (c: PlanCommitment[]) => PlanCommitment[]) => ({
	...data,
	// Kept in the order they're next due, as the server lists them.
	plan: {
		...data.plan,
		commitments: byNextDue(change(data.plan.commitments), `${data.plan.month}-01`),
	},
});

export const withNewCommitment = (data: MonthData, variables: CommitmentVariables) =>
	mapCommitments(data, (commitments) =>
		commitments.some((c) => c.id === variables.commitmentId)
			? commitments
			: [...commitments, toPlanCommitment(variables)],
	);

export const withCommitment = (data: MonthData, variables: CommitmentVariables) =>
	mapCommitments(data, (commitments) =>
		commitments.map((c) => (c.id === variables.commitmentId ? toPlanCommitment(variables, c) : c)),
	);

export const withoutCommitment = (data: MonthData, { commitmentId }: { commitmentId: string }) =>
	mapCommitments(data, (commitments) => commitments.filter((c) => c.id !== commitmentId));

export type PaymentVariables = {
	/** A client ULID: retrying or double-submitting the same payment records it once. */
	transactionId: string;
	commitmentId: string;
	commitmentName: string;
	amountCents: number;
	/** Today in the Household's time zone, as the server will date it. */
	date: DayKey;
};

/** Charges with a Commitment payment in them; adding the same one twice changes nothing. */
export function withPayment<T extends Pick<MonthData, "charges">>(
	data: T,
	variables: PaymentVariables,
): T {
	if (data.charges.some((charge) => charge.id === variables.transactionId)) return data;
	const charge: CommitmentCharge = {
		id: variables.transactionId,
		commitmentId: variables.commitmentId,
		amount: variables.amountCents,
		date: variables.date,
	};
	return { ...data, charges: [...data.charges, charge] };
}

/**
 * Records paying a Commitment today, as a Quick Add assigned to it. The payment lands in the
 * month's cached inputs at once (ADR-0006); a failure rolls back and offers a retry of the same
 * payment.
 */
export function useCommitmentPayment() {
	const queryClient = useQueryClient();
	const payment = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: ({ transactionId, commitmentId, amountCents }: PaymentVariables) =>
			addCommitmentPayment({ data: { transactionId, commitmentId, amountCents } }),
		onMutate: async (variables) => {
			const { queryKey } = monthQuery(monthOfDay(variables.date));
			const all = commitmentsQuery().queryKey;
			await Promise.all([
				queryClient.cancelQueries({ queryKey }),
				queryClient.cancelQueries({ queryKey: all }),
			]);
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, withPayment(previous, variables));
			// Coming up counts the payment at once too.
			const previousAll = queryClient.getQueryData(all);
			if (previousAll) queryClient.setQueryData(all, withPayment(previousAll, variables));
			return { previous, queryKey, previousAll };
		},
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
			if (context?.previousAll) {
				queryClient.setQueryData(commitmentsQuery().queryKey, context.previousAll);
			}
			toast(
				`Couldn’t record ${formatMoney(variables.amountCents)} paid to ${variables.commitmentName}, so it’s been undone.`,
				{ tone: "error", action: { label: "Retry", onClick: () => payment.mutate(variables) } },
			);
		},
		onSuccess: (_data, variables) => {
			toast(`${formatMoney(variables.amountCents)} paid to ${variables.commitmentName}`);
		},
		onSettled: () => {
			// Refetching while another change is in flight would briefly undo it on screen.
			if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
				return queryClient.invalidateQueries({ queryKey: monthsKey });
			}
		},
	});
	return payment;
}

/**
 * "$1,450 of $2,300 paid": a Commitment that pays down a card or loan, partly paid. Several
 * payments a month are the usual thing there, so it says how far along it is, not how far off
 * (ADR-0050). Null for any other Commitment, and once it's paid in full or over.
 */
export const partPaid = ({ accountId, difference, actual, expected }: CommitmentState) =>
	accountId && difference < 0 ? `${formatMoney(actual)} of ${formatMoney(expected)} paid` : null;

/**
 * What the month's Commitments have been paid, against what's expected: "$2,630 of $2,580 paid".
 * Money Paid back into one this month isn't a payment, so where it took a Commitment below what
 * was expected it is left out and said beside it: "$0 of $600 paid · $600 Paid back".
 */
export function commitmentsPaid(commitments: CommitmentState[]): string | null {
	if (commitments.length === 0) return null;
	const read = commitments.map(paymentsView);
	const paid = read.reduce((sum, c) => sum + c.actual, 0);
	const expected = read.reduce((sum, c) => sum + c.expected, 0);
	const back = read.reduce(
		(sum, c, i) => sum + (c === commitments[i] ? 0 : (c.paidBack?.amount ?? 0)),
		0,
	);
	return `${formatMoney(paid)} of ${formatMoney(expected)} paid${
		back > 0 ? ` · ${formatMoney(back)} Paid back` : ""
	}`;
}
