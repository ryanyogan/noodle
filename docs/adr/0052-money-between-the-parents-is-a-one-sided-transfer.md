# ADR-0052: Money between the two Parents is a one-sided Transfer

Status: accepted (2026-10-05, issue 92)

## Context

A Parent said: "we need to think of a way to handle transfers between parents as these aren't really global losses, only moving money to pay bills and such". When one Parent sends the other money (Zelle, Venmo, a bank transfer) the Household has gained and lost nothing. In practice only one Parent's Accounts are connected, so only one side of the move is in Noodle: a deposit that reads as Income (and can raise Extra income), or money out that waits in Review as spending.

The `transfers` table already allows one side alone (all three side columns are nullable; ADR-0050 and issue 91 use that for a card payment whose card isn't in Noodle), and every total already leaves a Transfer's sides out through `counts()` and `incomeCounts()` in `packages/db/src/counting.ts`.

## Decision

- Money between the Parents with one side in Noodle is a **one-sided Transfer with a reason**: `transfers.reason = 'between-us'`. No new table and no new counting rule.
- Money in: `markIncomeTransfer` writes a Transfer with only `in_income_id`. The income row stays; `incomeCounts()` takes it out of Income, Extra income, Reports and the take-home comparisons. It is listed under the month's Income as "Between us", outside the total, with "Count as Income" to undo (the ordinary unmark).
- Money out: `markTransfer` takes the reason. It is kept only when the side is marked alone; when the other side is in Noodle the pair is a plain Transfer and no reason is stored.
- A Parent always decides. Wording that looks person to person (`looksPersonToPerson`) only changes what is offered.
- Marking money in is refused while Extra income already decided in its month would no longer be covered without it: the same rule, and the same sentence, as removing that income. The Parent undoes the Extra income decision first.
- Closed months follow marking a Transfer: no extra rule.
- `transfers.other_account_id` (nullable) is added with it for the side Noodle can't see; nothing writes it yet.
- Migration 0055 only adds two nullable columns, so older snapshots restore as they are (ADR-0048).

## Consequences

- Money that went to the other Parent and then paid a bill from an Account Noodle doesn't follow is counted nowhere. Saying what it paid for (a Bucket or a Commitment) is a later step of issue 92.
- A Rule cannot say "always between us" yet (`rules` has no way to express a Transfer); proposed as `rules.transfer`.
- Unmarking is `unmarkTransfer`; income marked alone has no Transaction side, so either Parent may unmark it (income is the Household's, never private).
