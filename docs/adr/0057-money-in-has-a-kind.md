# ADR-0057: Money in has a kind; landing in checking no longer makes it Income

Status: accepted (2026-10-06)

## Context

Every deposit into a checking or savings Account became Income on Import, with no Review step (`imports.ts`, `bank-sync.ts`), and Income lived apart from Transactions so no spending total could count it. That was safe while the only money in was pay. In real use it is not: a Child's other parent pays the Household back by Zelle, a Child pays back from their own account, a refund lands in checking, one Parent's pay arrives in small chunks that look like none of the above. All of it counted as Income, could raise Extra income, and could only be removed or marked "Between us". Income had no "whose pay", could not be edited, and never showed on Transactions.

## Decision

- **Money in is one of five kinds**: Income, Refund, Paid back (ADR-0058), Transfer, Between us. A Parent can change which. Only Income counts toward the Take-home pay and Extra income.
- **Income is no longer the default.** A line is Income without asking only when its wording reads as payroll or a Rule says so. Person-to-person money in (Zelle, Venmo, PayPal, Cash App, Apple Cash) goes to Review. Anything else stays Income, as before, so a Household with one paycheck sees no change.
- **Income has "whose pay"**: a Parent, or the Household. Marking a line as Income offers to remember its sender as that Parent's pay. Whose pay, the note and the kind can always be changed; amount and date only on Income a Parent typed in.
- **Money in shows on Transactions**, with its kind, alongside spending.
- **A remembered pair of Accounts is always a Transfer** ("money from Gusto into Chase"), whatever the days or amounts, and when only one side is in Noodle that side is marked alone, naming the other.
- The guard from ADR-0052 holds for every change of kind away from Income: refused while Extra income already decided in its month would no longer be covered.

## Considered

- **Keep deposits as Income and add more ways out** (as Between us did). Each new case would be found only after it had been counted wrong.
- **Everything in goes to Review.** Correct, but a weekly paycheck would ask the same question forever; payroll wording and Rules answer it.
- **Take-home pay per Parent.** Still rejected, as in ADR-0040: "whose pay" on Income gives each Parent's range without a second planned figure.

## Consequences

- Money in filed to a Bucket or Commitment (a Refund into checking, Paid back) is new: assignment was for money out only.
- October 2026's person-to-person money in is put back into Review once, after a snapshot; lines that already fed a decided Extra income are left for a Parent.
- Rules must be able to say a kind, not only a Bucket or Commitment (the `rules.transfer` gap noted in ADR-0052).
