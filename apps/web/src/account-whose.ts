// Whose an Account is (issue 144, ADR-0059): a Parent's, or the Household's. Accounts are listed
// in a group per Parent who has any, the viewer's first, and the Household's last.

/** The Household in the "Whose Account" picker: Radix keeps "" for nothing chosen. */
export const WHOSE_HOUSEHOLD = "";
export const WHOSE_HOUSEHOLD_LABEL = "The Household";

type Parent = { id: string; name: string };

export type WhoseGroup<A> = {
	/** A Parent's Member id, or "household". */
	key: string;
	/** "Sam’s Accounts", "The Household’s Accounts". */
	title: string;
	accounts: A[];
};

/** The Parents with the viewer first, then the Household: the picker's and the page's order. */
export const whoseOrder = (parents: Parent[], viewerId: string): Parent[] => [
	...parents.filter((parent) => parent.id === viewerId),
	...parents.filter((parent) => parent.id !== viewerId),
];

export const whoseChoices = (parents: Parent[], viewerId: string) => [
	...whoseOrder(parents, viewerId).map((parent) => ({ value: parent.id, label: parent.name })),
	{ value: WHOSE_HOUSEHOLD, label: WHOSE_HOUSEHOLD_LABEL },
];

/**
 * The Accounts by whose they are: the viewer's, the other Parent's, then the Household's, each
 * in the order given, and none for a group with no Accounts. One that is nobody's, or whose
 * Member isn't a Parent here, is the Household's.
 */
export function whoseGroups<A extends { whose: string | null }>(
	accounts: A[],
	parents: Parent[],
	viewerId: string,
): WhoseGroup<A>[] {
	const ordered = whoseOrder(parents, viewerId);
	const known = new Set(ordered.map((parent) => parent.id));
	return [
		...ordered.map((parent) => ({
			key: parent.id,
			title: `${parent.name}’s Accounts`,
			accounts: accounts.filter((account) => account.whose === parent.id),
		})),
		{
			key: "household",
			title: `${WHOSE_HOUSEHOLD_LABEL}’s Accounts`,
			accounts: accounts.filter((account) => account.whose === null || !known.has(account.whose)),
		},
	].filter((group) => group.accounts.length > 0);
}

/** Within a group: cash, then cards and loans, as the page lists them. */
export const byKindOrder = <A extends { holdsMoney: boolean }>(accounts: A[]): A[] => [
	...accounts.filter((account) => account.holdsMoney),
	...accounts.filter((account) => !account.holdsMoney),
];
