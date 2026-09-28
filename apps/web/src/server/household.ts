import { findMembershipByClerkUser, type Household, type Member, type Viewer } from "@noodle/db";
import { createMiddleware } from "@tanstack/react-start";
import { requireUserId } from "./auth";
import { getDb } from "./db";

/** What the client needs to know about its Household. */
export type HouseholdSummary = Pick<Household, "id" | "name" | "timeZone">;

export const toHouseholdSummary = ({ id, name, timeZone }: Household): HouseholdSummary => ({
	id,
	name,
	timeZone,
});

/**
 * The signed-in Parent as the reader of their Household's Transactions: every read of them is
 * made for a Viewer, so the other Parent's Personal Allowance stays private (ADR-0003).
 */
export const viewerOf = (context: {
	household: Pick<Household, "id">;
	parent: Pick<Member, "id">;
}): Viewer => ({ householdId: context.household.id, memberId: context.parent.id });

/**
 * Every Household-scoped server function uses this middleware: the Household is
 * resolved from the Clerk session and handed to the handler as context.
 */
export const householdMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const membership = await findMembershipByClerkUser(getDb(), await requireUserId());
		if (!membership) throw new Error("No Household for this Parent");
		return next({ context: { household: membership.household, parent: membership.parent } });
	},
);
