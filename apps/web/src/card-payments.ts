import type { MonthKey, PaymentCase } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ulid } from "ulid";
import { monthsKey, rulesQuery } from "./queries";
import { fileCardPayment, undoCardPaymentFiling } from "./server/card-payments";
import { forgetCardPayment, getCardPaymentCards, getCardPaymentRules } from "./server/transfers";

// "It's a card payment" (issue 136): one named choice that asks which card. A card Noodle follows
// or keeps by statements makes it a Transfer naming the card; a card kept by hand that a
// Commitment pays down files it in that Commitment; a card that isn't in Noodle asks whether the
// payment counts as spending. The answer is remembered for the line's wording.

export type { CardPaymentCard, CardPaymentRule } from "./server/transfers";

/** The Household's cards, each with the Commitment its payment is filed in when kept by hand. */
export const cardPaymentCardsQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "card-payment-cards"],
		queryFn: () => getCardPaymentCards(),
	});

/** The wordings remembered as card payments; under the Rules' key, so a change refetches it. */
export const cardPaymentRulesQuery = () =>
	queryOptions({
		queryKey: [...rulesQuery().queryKey, "card-payments"],
		queryFn: () => getCardPaymentRules(),
	});

/** Forgets a remembered card-payment wording. */
export function useForgetCardPayment() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (pattern: string) => forgetCardPayment({ data: { pattern } }),
		onError: () => toast("Couldn’t remove it, so it’s still remembered.", { tone: "error" }),
		onSuccess: () =>
			toast("No longer remembered. Transfers already marked stay as they are.", {
				tone: "success",
			}),
		onSettled: () => queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
	});
}

/** An answer where the payment is the spending: the Commitment it's filed in, made here or not. */
export type CardPaymentFilingInput = {
	transactionId: string;
	ruleId: string;
	label: string;
	commitment: { id: string; name: string };
	/** Set when the Commitment is made by this answer: its first month, amount and due day. */
	create?: { month: MonthKey; amountCents: number; dueDate: string };
	/** After the Undo has put everything back. */
	onUndo?: () => void;
	/**
	 * Called once it's filed, with its Undo (the same one the toast has; it runs once): for a
	 * screen whose own Undo must take the whole answer back, as Review's stack does.
	 */
	onFiled?: (undo: () => void) => void;
	/** What the toast's Undo does instead of undoing by itself: Review's goes through its stack. */
	undoBy?: () => void;
	/** When it couldn't be filed. */
	onFail?: () => void;
	/** When the line stays as it is, its month having ended (Review puts its card back). */
	onStays?: () => void;
};

/**
 * What the toast says once a card payment's answer "it's the spending" is in. A payment in a month
 * that has ended stays as it is (`endedMonth`, a month key): a past month's Plan can't change, so
 * the Commitment starts this month and only later payments are filed in it.
 */
export function cardPaymentFiled(done: {
	label: string;
	commitment: string;
	/** The Commitment was made by this answer. */
	made: boolean;
	/** How many lines went into it. */
	filed: number;
	/** A Rule files later payments there. */
	remembered: boolean;
	endedMonth?: string;
}) {
	if (done.endedMonth) {
		const month = new Date(`${done.endedMonth}-15T12:00:00Z`).toLocaleDateString("en-US", {
			month: "long",
			timeZone: "UTC",
		});
		const others =
			done.filed > 0
				? ` ${done.filed === 1 ? "1 payment" : `${done.filed} payments`} worded like it since then ${done.filed === 1 ? "is" : "are"} filed there now.`
				: "";
		const start = done.made ? `${done.commitment} is now a Commitment. ` : "";
		return done.remembered
			? `${start}${month} has ended, so this payment stays as it is; later payments will be filed in ${done.commitment}.${others}`
			: `${start}${month} has ended, so this payment stays as it is.${others}`;
	}
	const more = done.filed > 1 ? `, with ${done.filed - 1} more worded like it` : "";
	const later = done.remembered ? " Payments worded like it will be too." : "";
	return done.made
		? `${done.commitment} is now a Commitment, and this payment is filed in it${more}.${later}`
		: `${done.label} filed in ${done.commitment}${more}.${later}`;
}

/**
 * A payment that is the card's spending: filed in the Commitment (made first, for a card that
 * isn't in Noodle), with the lines already here that say the same, by a Rule for its wording, so
 * later payments are filed there too. One Undo takes all of it back.
 */
export function useCardPaymentFiling() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const refetch = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: monthsKey }),
			queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
		]);
	const couldnt = (input: CardPaymentFilingInput) => {
		toast(`Couldn’t file ${input.label} in ${input.commitment.name}.`, { tone: "error" });
		input.onFail?.();
	};
	return useMutation({
		mutationFn: (input: CardPaymentFilingInput) =>
			fileCardPayment({
				data: {
					transactionId: input.transactionId,
					commitmentId: input.commitment.id,
					ruleId: input.ruleId,
					create: input.create && { ...input.create, name: input.commitment.name },
				},
			}),
		onError: (_error, input) => couldnt(input),
		onSuccess: (result, input) => {
			if (!result.ok) return couldnt(input);
			// The Commitment's first month: the payment's, or this month when that one has ended.
			const madeIn = result.madeIn ?? input.create?.month;
			const created = input.create &&
				madeIn && { commitmentId: input.commitment.id, month: madeIn };
			const said = cardPaymentFiled({
				label: input.label,
				commitment: input.commitment.name,
				made: input.create !== undefined,
				filed: result.filed,
				remembered: result.ruleId !== null,
				endedMonth: result.stays ? result.lineMonth : undefined,
			});
			// One toast: Undo, and beside it the way to the Commitment made here.
			const edit = input.create && {
				label: "Edit",
				onClick: () =>
					void navigate({
						to: "/plan/$month/commitments/$id",
						params: { month: madeIn as MonthKey, id: input.commitment.id },
					}),
			};
			let over = false;
			let drop = () => {};
			const undo = () => {
				if (over) return;
				over = true;
				drop();
				void undoCardPaymentFiling({
					data: {
						undo: result.undo,
						ruleId: result.ruleId,
						ruleBefore: result.ruleBefore,
						months: result.months,
						created,
					},
				})
					.then(() => (result.stays ? undefined : input.onUndo?.()))
					.catch(() => toast("Couldn’t undo that.", { tone: "error" }))
					.finally(refetch);
			};
			// A line that stayed where it was never left the screen: its Undo is the toast's alone.
			const viaScreen = result.stays ? undefined : input.undoBy;
			drop = toast(said, { tone: "success", action: edit || undefined, undo: viaScreen ?? undo });
			if (!result.stays) input.onFiled?.(undo);
			if (result.stays) input.onStays?.();
		},
		onSettled: refetch,
	});
}

/**
 * The card Review's reading of a line (paymentCase) names, for "It's a card payment" there: one of
 * the Household's credit cards, or `id` null for a card that isn't in Noodle. Undefined when the
 * reading names no card for sure (a loan, or a followed card it couldn't tell apart): the line is
 * then marked as a plain Transfer and nothing is remembered.
 */
export function cardNamedBy(
	payment: PaymentCase | null | undefined,
	accounts: { id: string; name: string; kind: string }[],
): { id: string | null; name: string | null } | undefined {
	if (!payment || payment.kind === "commitment") return undefined;
	const cards = accounts.filter((account) => account.kind === "credit-card");
	if (payment.kind === "not-followed" && payment.accountId === null)
		return { id: null, name: null };
	const card =
		payment.kind === "not-followed"
			? cards.find((account) => account.id === payment.accountId)
			: cards.find((account) => account.name === payment.card);
	return card ? { id: card.id, name: card.name } : undefined;
}

/**
 * Whether Review's "It's a card payment" asks which card before anything is marked: when the line
 * reads as a card's payment and its wording names no one card in Noodle for sure (two cards fit,
 * or none does: it may be one kept by hand under another name, or a card that isn't here, which
 * is then asked whether the payment counts as spending). A line that names its card is marked in
 * one click, with Undo; so is one that doesn't read as a card's payment at all.
 */
export function asksWhichCard(
	payment: PaymentCase | null | undefined,
	accounts: { id: string; name: string; kind: string }[],
): boolean {
	if (!payment || payment.kind === "commitment") return false;
	return !cardNamedBy(payment, accounts)?.id;
}

/**
 * The name of a Commitment made for a card from its payment's wording: what the line is called,
 * in ordinary capitals when the bank shouted it, at most the 40 a Commitment's name takes.
 */
export function commitmentNameFor(label: string) {
	const words = label.replace(/\s+/g, " ").trim();
	const plain =
		words === words.toUpperCase()
			? words.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (first) => first.toUpperCase())
			: words;
	return plain.slice(0, 40).trim() || "Card payment";
}

/**
 * "Count this payment as spending? Yes": the payment's own Commitment, made in place (new ids
 * each time it's asked), monthly at the payment's amount and due on its day, with the payment
 * filed in it. The one way to it, from the choice's "Yes, make a Commitment" and from Review's
 * "Make it a Commitment" on a card that isn't in Noodle.
 */
export function paymentAsSpending(
	line: { id: string; date: string; amountCents: number },
	label: string,
): Pick<CardPaymentFilingInput, "transactionId" | "ruleId" | "label" | "commitment"> & {
	create: NonNullable<CardPaymentFilingInput["create"]>;
} {
	return {
		transactionId: line.id,
		ruleId: ulid(),
		label,
		commitment: { id: ulid(), name: commitmentNameFor(label) },
		create: {
			month: line.date.slice(0, 7) as MonthKey,
			amountCents: line.amountCents,
			dueDate: line.date,
		},
	};
}

// The Transactions row's own "It's a card payment" opens the row with the question already asked.
// Which line was asked about waits here until its detail is drawn; one already open hears the event.
let asked: string | null = null;
const ASKED = "noodle:card-payment";

/** Asks "Which card does it pay?" for a line, wherever its choice is (or is about to be) drawn. */
export function askCardPayment(transactionId: string) {
	asked = transactionId;
	window.dispatchEvent(new CustomEvent(ASKED, { detail: transactionId }));
}

/** Whether `transactionId` was just asked about; asking is used up by the answer "yes". */
export function takeAskedCardPayment(transactionId: string) {
	if (asked !== transactionId) return false;
	asked = null;
	return true;
}

/** Calls `open` when `transactionId` is asked about while its choice is on screen. */
export function onCardPaymentAsked(transactionId: string, open: () => void) {
	const heard = (event: Event) => {
		if (
			(event as CustomEvent<string>).detail === transactionId &&
			takeAskedCardPayment(transactionId)
		)
			open();
	};
	window.addEventListener(ASKED, heard);
	return () => window.removeEventListener(ASKED, heard);
}
