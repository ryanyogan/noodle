import type { Cents } from "./money";
import { type CommitmentState, paymentsView } from "./month-state";

/**
 * What a Commitment is, for the list of them (issue 153): a credit card's payment, a loan's, or a
 * plain bill. Worked out from the Account it pays down (ADR-0050), never stored.
 */
export type CommitmentKind = "credit-card" | "loan" | "bill";

/** The order the list shows them in. */
export const COMMITMENT_KINDS = [
	"credit-card",
	"loan",
	"bill",
] as const satisfies readonly CommitmentKind[];

/**
 * A Commitment's kind from the Account it pays down: a credit card's, a loan's, or a bill for one
 * that pays nothing down (or whose Account isn't a card or loan, or can't be found).
 */
export function commitmentKind(paysDown: { kind: string } | null | undefined): CommitmentKind {
	return paysDown?.kind === "credit-card" || paysDown?.kind === "loan" ? paysDown.kind : "bill";
}

export type CommitmentGroup<T> = {
	kind: CommitmentKind;
	/** In the order they were given. */
	commitments: T[];
	/** What the group takes this month. */
	expected: Cents;
	/** What has been paid to it this month, as its rows say it (`paymentsView`). */
	paid: Cents;
};

/**
 * A month's Commitments in their groups: credit cards, loans, then bills, each with what it takes
 * and what has been paid. A group with nothing in it is left out, and the order within a group is
 * the order given, so a list sorted first stays sorted inside each group. `accounts` is every
 * Account a Commitment might pay down, archived ones too.
 */
export function groupCommitments<T extends CommitmentState>(
	commitments: readonly T[],
	accounts: readonly { id: string; kind: string }[],
): CommitmentGroup<T>[] {
	const byId = new Map(accounts.map((account) => [account.id, account]));
	return COMMITMENT_KINDS.flatMap((kind) => {
		const own = commitments.filter(
			(c) => commitmentKind(c.accountId ? byId.get(c.accountId) : null) === kind,
		);
		if (own.length === 0) return [];
		return [
			{
				kind,
				commitments: own,
				expected: own.reduce((sum, c) => sum + c.expected, 0) as Cents,
				paid: own.reduce((sum, c) => sum + paymentsView(c).actual, 0) as Cents,
			},
		];
	});
}
