import {
	type CardKept,
	type Cents,
	cardKept,
	type DayKey,
	type PayingCommitment,
	type PaymentAccount,
	type PurchasesGetIn,
	paymentCase,
	statementsFollowed,
} from "@noodle/domain";

// A card's home (issue 150): what its row on Accounts and its own page say about paying it. How
// paying a card counts follows from how its purchases get into Noodle (CONTEXT.md, "A card kept by
// hand / by statements"): when they are in Noodle, paying it is a Transfer; when they aren't, the
// payment is the spending.

type Card = {
	id: string;
	name: string;
	kind: string;
	bankConnectionId: string | null;
	purchases: PurchasesGetIn | null;
	lastStatementDate: DayKey | null;
};

/** How a card's purchases get in today: its bank, the Parent's answer, statements lately, or null. */
export const keptOf = (card: Card, today: DayKey): CardKept | null =>
	cardKept({ ...card, followed: statementsFollowed(card.lastStatementDate, today) });

/** In a few words, for the card's row on Accounts. */
export const PAYING_BRIEF: Record<CardKept | "unsaid", string> = {
	bank: "Purchases come from the bank",
	statements: "Purchases come from its statements",
	hand: "You add its purchases",
	none: "Purchases aren’t in Noodle · its payment is the spending",
	unsaid: "Not said yet how its purchases get in",
};

export const payingBrief = (kept: CardKept | null): string => PAYING_BRIEF[kept ?? "unsaid"];

/** The same, as a whole sentence for the card's own page; `bank` names a connected card's bank. */
export function payingWhole(kept: CardKept | null, bank: string | null): string {
	switch (kept) {
		case "bank":
			return `Its purchases come from ${bank ?? "the bank"}, so paying it is a Transfer, not spending.`;
		case "statements":
			return "Its purchases come from its statements, so paying it is a Transfer, not spending.";
		case "hand":
			return "You add its purchases yourself, so paying it is a Transfer, not spending. A payment brings what’s owed down.";
		case "none":
			return "Its purchases aren’t in Noodle, so its payment is the spending: plan it as a Commitment.";
		case null:
			return "Nobody has said how its purchases get in yet. That decides how paying it counts.";
	}
}

/** "1 payment" / "3 payments". */
export const paymentsCount = (count: number) => `${count} ${count === 1 ? "payment" : "payments"}`;

type Waiting = {
	note: string | null;
	merchant: string;
	merchantName?: string | null;
	amountCents: Cents;
	importedFrom: string | null;
};

/**
 * The lines waiting in Review that read as a payment to a card, counted by the card each names
 * (the same reading Review gives them: paymentCase over the bank's wording). `elsewhere` counts
 * the ones that read as a card's payment and name no card in Noodle for sure.
 */
export function waitingCardPayments(
	items: readonly Waiting[],
	accounts: readonly Card[],
	followed: readonly string[],
	commitments: readonly PayingCommitment[],
): { byCard: Map<string, number>; elsewhere: number; total: number } {
	const follows = new Set(followed);
	const cardsAndLoans: PaymentAccount[] = accounts.flatMap((account) =>
		account.kind === "credit-card" || account.kind === "loan"
			? [
					{
						id: account.id,
						name: account.name,
						kind: account.kind,
						followed:
							account.kind === "credit-card" &&
							(account.bankConnectionId !== null || follows.has(account.id)),
					},
				]
			: [],
	);
	const cards = cardsAndLoans.filter((account) => account.kind === "credit-card");
	const byCard = new Map<string, number>();
	let elsewhere = 0;
	for (const item of items) {
		const payment = paymentCase(
			{
				text: item.note || (item.merchantName ?? item.merchant),
				amountCents: item.amountCents,
				from: item.importedFrom,
			},
			cardsAndLoans,
			[...commitments],
		);
		if (!payment) continue;
		const id =
			payment.kind === "followed"
				? (cards.find((card) => card.name === payment.card)?.id ?? null)
				: payment.accountId;
		if (id === null) elsewhere += 1;
		else if (cards.some((card) => card.id === id)) byCard.set(id, (byCard.get(id) ?? 0) + 1);
	}
	const named = [...byCard.values()].reduce((sum, count) => sum + count, 0);
	return { byCard, elsewhere, total: named + elsewhere };
}
