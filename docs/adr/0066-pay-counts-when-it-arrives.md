# ADR-0066: Pay counts when it arrives; pay to come counts nowhere

Status: accepted (2026-10-08, issue 159 phase a)

Builds on [ADR-0040](0040-plan-on-pay-you-can-count-on.md) and [ADR-0063](0063-a-paycheck-counts-on-its-pay-day.md).

## Context

One Parent consults. Clients pay late, sometimes a month after the work, and unevenly. Noodle knew two ways of being paid: a Salary, whose paycheck counts on its Pay day (ADR-0063), and "hourly, or pay that varies", which is nothing to set. For the second there was nowhere to say "I've earned this and it hasn't come", so a month whose payment was late read as a month with no pay and no reason, and the payment, when it landed, as a surprise.

## Decision

- **A payment counts as Income in the month it arrives** (the owner, 2026-10-08). Not the month the work was done, and not the day it was expected. Nothing about how Income is counted changes: the line of Income, its date and `incomeCountsOn` are as they were.
- **Pay to come is a note of what is on its way, and counts nowhere.** A Parent records who it is from, the amount and (optionally) the day it is expected. It is two new tables (`pay_to_come`, `pay_to_come_arrivals`, migration 0092) that no total reads: not Income, the Take-home pay, Extra income, Free to Spend, Reports or the Carry-over chain. Plan › Income lists it under the Parent as "Earned, not in yet", with its total, and says one past its expected day as "Late by N days".
- **Arriving is a link, not a move.** When the money lands it is a line of Income of its own, counted where it landed. `pay_to_come_arrivals` keeps which line a Pay to come arrived as and how much of it that line is; what is still to come is the amount less its arrivals. One line of Income is one payment at most (a partial unique index says so in the table).
- **The exact amount is matched; anything else is a Parent's to say.** `payToComeMatches` keeps a line on a Pay to come without asking only when it is the same Parent's pay, landed on or after the day the Pay to come was recorded, is not the pay for a Pay day, is exactly what is still to come, and is the only Pay to come that line can be and the only line it can be. It runs where `matchPayDays` does (an Import or bank sync, a kind changed to Income, whose pay set or stated by Rule), after it.
- **Within $50 it is offered.** A line within `PAY_TO_COME_WITHIN` ($50) either way, or the exact amount of Income nobody has said whose pay it is, or an exact amount that is ambiguous, is offered on Plan › Income: "Is this it?". $50, because what comes off a client's payment on the way is a bank's wire fee ($15 to $50 in the US); a card processor's cut is a percentage and can be more, which a Parent says by hand. "Yes" takes it as all of it, whatever the few dollars' difference: the Income keeps its own amount.
- **A part leaves the rest waiting.** By hand a Parent can pick any of that Parent's Income (or nobody's, which then becomes theirs) from 31 days before the Pay to come was recorded, and say it is all of it or part of it. A part covers its own amount; the rest stays listed, and is matched or offered like any other when it lands.
- **By hand, and it sticks.** "Undo" on one that is in, and "No" to an offer, write the same thing: that line is not that pay (`not_this`). It waits again, and neither the rule nor an offer brings that line back for it. This is `pay_day_by_hand` of ADR-0063 for a pair.
- **An arrival holds only while its Income counts.** `income_id` is not a foreign key, and every read joins to Income that still counts. A line a Parent removes, the bank takes back, or that turns out to be a Transfer stops being an arrival on its own, and the pay waits again.
- **It is the Household's.** Income is never private (ADR-0057) and either Parent says how either is paid (ADR-0063), so both Parents read all Pay to come and either records it for either. ADR-0003 is untouched: nothing here is in a Personal Allowance. It is in the download (`pay-to-come.csv`) for both, is cleared by Start fresh and Delete Household, and is in snapshots, so a restore rewinds it together with the Income it points at.
- **Not a Plan change, so not in the Log.** Like how a Parent is paid, it changes no month's Plan.

## Considered

- **Counting pay when it is earned.** The month would show what the work was worth, and a late client would not make it look lean. Rejected: the Household spends from what is in the account, so Free to Spend built on money not yet in would be money that cannot be spent, and a client who never pays would leave Income that has to be taken back out of a month that may be closed. It would also give one line of Income two months (earned and landed) and every total a second rule, where ADR-0063 worked to leave one.
- **Counting it on its expected day**, as a paycheck counts on its Pay day. A Pay day is a schedule an employer keeps to within days; an expected day is a client's promise. The $300 and 5 days of ADR-0063 have no honest equivalent here.
- **A new kind of money in ("expected").** Rows of the `income` table that do not count yet. Rejected: every read of Income would need to leave them out (ADR-0057's kinds are all money that landed), and a mistake there is money counted that isn't there.
- **Matching within a tolerance without asking**, as a paycheck is. A paycheck has a Pay day to hold it to; here two clients can owe similar amounts in the same week. Only the exact amount with nothing else it could be is safe to match silently.

## Consequences

- A lean month is still lean in the figures; what phase a adds is the reason beside them. What to plan on (the 6 and 12 month average and lowest month), how short a lean month is, and holding a better month's Extra income for lean ones are the rest of issue 159.
- A Pay to come still waiting is listed on every month from the one it was recorded in to the current one (or the one it is expected in, if later): it was not in during any of them. Late is always against today.
- A Parent who is on a Salary and also has side work is not offered "Add pay to come" yet; what they already recorded stays listed.
- An arrival row whose Income has been removed stays in the table, read as nothing. It is cleared with the Pay to come.
