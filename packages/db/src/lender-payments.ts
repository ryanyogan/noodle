import type { LoanPaidDown, MonthKey } from "@noodle/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { accounts, commitments, commitmentTerms } from "./schema";

// The Household's loans a Commitment pays down (ADR-0050), as a payment line is read against them
// when it arrives (issue 153, phase c; lenderPayment and ruledLoanPayment in @noodle/domain). A
// Commitment has no owner (ADR-0030), so these are the same for both Parents.

/** A loan and the Commitment that pays it down, with the months that Commitment is in the Plan. */
export type LoanPaidDownRow = LoanPaidDown & {
	fromMonth: MonthKey;
	endedFromMonth: MonthKey | null;
};

/**
 * Every loan in use that a Commitment pays down. Its payment is what the Parent said the loan's
 * is, else what its Commitment plans (its latest terms).
 */
export async function loadLoansPaidDown(db: Db, householdId: string): Promise<LoanPaidDownRow[]> {
	const rows = await db
		.select({
			accountId: accounts.id,
			name: accounts.name,
			commitmentId: commitments.id,
			commitment: commitments.name,
			paymentCents: sql<number>`coalesce(${accounts.paymentCents}, (
				select ${commitmentTerms.amountCents} from ${commitmentTerms}
				where ${commitmentTerms.commitmentId} = ${commitments.id}
				order by ${commitmentTerms.month} desc limit 1), 0)`,
			fromMonth: commitments.fromMonth,
			endedFromMonth: commitments.endedFromMonth,
		})
		.from(commitments)
		.innerJoin(accounts, eq(accounts.id, commitments.accountId))
		.where(
			and(
				eq(commitments.householdId, householdId),
				eq(accounts.householdId, householdId),
				eq(accounts.kind, "loan"),
				isNull(accounts.archivedAt),
			),
		)
		.orderBy(accounts.name, commitments.id);
	return rows as LoanPaidDownRow[];
}

/** Those whose Commitment is in the Plan for `month`: a payment is only ever filed in one that is. */
export const loansPaidDownIn = (loans: LoanPaidDownRow[], month: string): LoanPaidDownRow[] =>
	loans.filter(
		(loan) =>
			loan.fromMonth <= month && (loan.endedFromMonth === null || loan.endedFromMonth > month),
	);
