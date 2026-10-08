import { type DayKey, dayKeyAt, type LoanPayment, loanPaidOffOn } from "@noodle/domain";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { accountBalances, accounts, commitments, households, splits, transactions } from "./schema";

// When a loan was paid off (issue 153, phase d). Nothing is written when what's owed reaches $0:
// the Plan's records are read with the day worked out from the loan's latest balance and the
// payments filed in the Commitments that pay it down, as what's owed itself is (ADR-0050). So
// deleting, moving or un-filing the payment that paid it off, or entering a balance above $0,
// puts the Commitment back in the Plan with no further write.

/** A loan some Commitment of the Household's pays down. */
const paidDownLoan = (householdId: string) =>
	and(
		eq(accounts.householdId, householdId),
		eq(accounts.kind, "loan"),
		sql`exists (select 1 from ${commitments} where ${commitments.accountId} = ${accounts.id})`,
	);

/**
 * What loanPaidOffOn needs for each loan a Commitment pays down, for a batch: the loans, their
 * balances (the latest first), and the payments filed in those Commitments, whole Transactions
 * then Splits. Each query names its columns apart: D1 hands a batch its rows keyed by column name.
 */
export const paidOffQueries = (db: Db, householdId: string) =>
	[
		db
			.select({
				accountId: accounts.id,
				bankConnectionId: accounts.bankConnectionId,
				timeZone: households.timeZone,
			})
			.from(accounts)
			.innerJoin(households, eq(households.id, accounts.householdId))
			.where(paidDownLoan(householdId)),
		db
			.select({
				accountId: accountBalances.accountId,
				amount: accountBalances.amountCents,
				at: accountBalances.createdAt,
				asOf: accountBalances.asOf,
			})
			.from(accountBalances)
			.innerJoin(accounts, eq(accounts.id, accountBalances.accountId))
			.where(and(eq(accountBalances.householdId, householdId), paidDownLoan(householdId)))
			.orderBy(desc(accountBalances.createdAt), desc(accountBalances.id)),
		db
			.select({
				accountId: commitments.accountId,
				amount: transactions.amountCents,
				date: transactions.date,
			})
			.from(transactions)
			.innerJoin(commitments, eq(commitments.id, transactions.commitmentId))
			.innerJoin(accounts, eq(accounts.id, commitments.accountId))
			.where(
				and(
					eq(transactions.householdId, householdId),
					isNotNull(commitments.accountId),
					eq(accounts.kind, "loan"),
					counts(),
				),
			),
		db
			.select({
				accountId: commitments.accountId,
				amount: splits.amountCents,
				date: transactions.date,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.innerJoin(commitments, eq(commitments.id, splits.commitmentId))
			.innerJoin(accounts, eq(accounts.id, commitments.accountId))
			.where(
				and(
					eq(splits.householdId, householdId),
					isNotNull(commitments.accountId),
					eq(accounts.kind, "loan"),
					counts(),
				),
			),
	] as const;

type PaymentRow = { accountId: string | null; amount: number; date: string };

/** The day each paid-off loan was paid off, by Account; a loan that still owes isn't in it. */
export function paidOffDays(
	loans: readonly { accountId: string; bankConnectionId: string | null; timeZone: string }[],
	balances: readonly { accountId: string; amount: number; at: Date; asOf: string | null }[],
	whole: readonly PaymentRow[],
	split: readonly PaymentRow[],
): Map<string, DayKey> {
	const days = new Map<string, DayKey>();
	for (const loan of loans) {
		// The latest first, as they were read.
		const balance = balances.find((row) => row.accountId === loan.accountId);
		if (!balance) continue;
		const day = loanPaidOffOn(
			{
				amount: balance.amount,
				// The day it was true, else the day it was recorded in the Household's time zone.
				day: (balance.asOf as DayKey | null) ?? dayKeyAt(balance.at, loan.timeZone),
			},
			[...whole, ...split].filter((row) => row.accountId === loan.accountId) as LoanPayment[],
			loan.bankConnectionId !== null,
		);
		if (day !== null) days.set(loan.accountId, day);
	}
	return days;
}
