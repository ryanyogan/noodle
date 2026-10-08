import type { PayingCommitment } from "@noodle/domain";
import { paidToCards } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useId, useMemo } from "react";
import { keptOf, payingBrief, payingWhole, paymentsCount, waitingCardPayments } from "../card-home";
import { cardPaymentRulesQuery } from "../card-payments";
import { formatMoney, monthName } from "../format";
import { type AccountView, useGoals } from "../goals";
import {
	commitmentsQuery,
	followedCardsQuery,
	goalsQuery,
	monthQuery,
	reviewQuery,
} from "../queries";
import { CardKeptSection } from "./card-kept";

// A card's home (issue 150): what its row on Accounts and its own page say about paying it. What
// was paid comes from the two lists the card's page shows under Payments; what waits comes from
// Review's own reading of each line. Nothing here changes how a payment is treated.

const inlineLink = "font-medium text-foreground underline underline-offset-3";

/**
 * This month's payments to each card or loan, and the card payments waiting in Review by the card
 * each names. The waiting counts come in once Review's list has loaded; until then none wait.
 */
export function useCardsHome() {
	const data = useSuspenseQuery(goalsQuery()).data;
	const month = data.month;
	const paid = useMemo(() => paidToCards(data, month), [data, month]);
	const items = useQuery(reviewQuery()).data?.items;
	const followed = useQuery(followedCardsQuery()).data;
	const plan = useQuery(monthQuery(month)).data?.plan;
	const waiting = useMemo(() => {
		const paying: PayingCommitment[] = (plan?.commitments ?? []).flatMap((commitment) =>
			commitment.accountId
				? [
						{
							id: commitment.id,
							name: commitment.name,
							accountId: commitment.accountId,
							amountCents: commitment.amount,
							carriedBalance: commitment.carriedBalance ?? false,
						},
					]
				: [],
		);
		return waitingCardPayments(items ?? [], data.accounts, followed ?? [], paying);
	}, [items, data.accounts, followed, plan]);
	return { month, paid, waiting };
}

/** What a credit card's row on Accounts says about paying it; null for any other Account. */
export function useCardFacts(account: AccountView) {
	const { month, paid, waiting } = useCardsHome();
	const { asOf } = useGoals();
	if (account.kind !== "credit-card") return null;
	const paidHere = paid.get(account.id) ?? 0;
	const waits = waiting.byCard.get(account.id) ?? 0;
	return {
		paying: payingBrief(keptOf(account, asOf)),
		paid:
			paidHere > 0
				? `Paid in ${monthName(month)}: ${formatMoney(paidHere)}`
				: `Nothing paid in ${monthName(month)}`,
		waiting: waits > 0 ? `${paymentsCount(waits)} waiting in Review` : null,
	};
}

/**
 * On a credit card's page, under its Payments: how paying it counts, said in one sentence, with
 * what decides it together below: how its purchases get in (and the control to change that), the
 * Commitment that pays it down, and the wordings Noodle remembers as a payment to it.
 */
export function CardPaying({ account, bank }: { account: AccountView; bank: string | null }) {
	const id = useId();
	const { asOf } = useGoals();
	const lead = payingWhole(keptOf(account, asOf), bank);
	const extras = <PayingExtras account={account} />;
	// A card its bank brings in has nothing to answer: the bank is how its purchases get in.
	if (account.bankConnectionId === null)
		return <CardKeptSection account={account} lead={lead} extras={extras} />;
	return (
		<Section aria-labelledby={id}>
			<SectionHeader id={id} title="How paying it counts" />
			<Card>
				<p data-slot="card-paying" className="p-(--card-pad) text-sm font-semibold">
					{lead}
				</p>
				{extras}
			</Card>
		</Section>
	);
}

/** The Commitment that pays the card down and the wordings remembered as a payment to it. */
function PayingExtras({ account }: { account: AccountView }) {
	const month = useSuspenseQuery(goalsQuery()).data.month;
	const commitments = useQuery(commitmentsQuery()).data?.commitments ?? [];
	const paying = commitments.filter(
		(c) => c.accountId === account.id && (c.endedFromMonth === null || c.endedFromMonth > month),
	);
	// A remembered wording names its card by name; one for a card that isn't in Noodle names none.
	const remembered = (useQuery(cardPaymentRulesQuery()).data ?? []).filter(
		(rule) => rule.card === account.name,
	);
	if (paying.length === 0 && remembered.length === 0) return null;
	return (
		<div className="grid gap-3 border-t p-(--card-pad) text-sm text-muted-foreground">
			{paying.length > 0 ? (
				<p data-slot="card-paid-down-by">
					Paid down by{" "}
					{paying.map((c, i) => (
						<Fragment key={c.id}>
							{i > 0 ? ", " : ""}
							<Link
								to="/plan/$month/commitments/$id"
								params={{ month, id: c.id }}
								className={inlineLink}
							>
								{c.name}
							</Link>
						</Fragment>
					))}
					: a payment filed there brings what’s owed down.
				</p>
			) : null}
			{remembered.length > 0 ? (
				<div data-slot="card-remembered" className="grid gap-1">
					<p>
						Noodle remembers {remembered.length === 1 ? "this wording" : "these wordings"} as a
						payment to it:
					</p>
					<ul className="grid gap-0.5 text-foreground">
						{remembered.map((rule) => (
							<li key={rule.id} className="[overflow-wrap:anywhere]">
								“{rule.pattern}”
							</li>
						))}
					</ul>
					<p>
						<Link to="/review/rules" className={inlineLink}>
							Change what’s remembered in Rules
						</Link>
					</p>
				</div>
			) : null}
		</div>
	);
}
