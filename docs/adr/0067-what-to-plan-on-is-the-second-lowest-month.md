# ADR-0067: What to plan on is the second-lowest month; a lean month is "in so far" until its last days

Status: accepted (2026-10-08, issue 159 phase b)

Builds on [ADR-0040](0040-plan-on-pay-you-can-count-on.md) and [ADR-0066](0066-pay-counts-when-it-arrives.md).

## Context

ADR-0040 has the Plan count on "the lowest it usually is" for a Parent whose pay varies, and ADR-0057 reads that off the last three full months. For a Parent who consults, three months is one client's payment habits: pay counts in the month it arrives (ADR-0066), so a client a month late makes one month of nearly nothing and the next a double. The lowest of three is then either a freak or nothing like the year. And a month whose pay has not landed yet read as a month with no pay, with the Pay to come listed further down the page and never set against it.

## Decision

- **What a Parent's pay has been** is their Income by month over the twelve months before the one being read, from Income that counts and is marked as their pay (`payHistory`, `packages/domain/src/pay-history.ts`). It is shown on Plan › Income for each Parent who is not on a Salary and has Income of their own in those months: a row of bars, the average of the last 6 and of all that count, the lowest month and the highest. Nothing is stored.
- **Only months that have ended count, from the first month Noodle has that Parent's Income for.** The month being read is shown beside them and is in no figure. Months before the first Income are months Noodle knows nothing about; a month with nothing in after it is a month of $0 and counts, because for pay that counts when it arrives that is exactly what a lean month is. With fewer than 6 the page says how many ("3 months so far").
- **What to plan on is the second-lowest of those months** (`planOn`), once there are 6. It is the figure the Parent was paid, or more, in every month but one, and the page says it that way so it can be checked against the bars: "In 11 of the last 12 months Wren's pay came to $3,800 or more. Only March ($900) was lower, and one month like that is left out." When the two lowest months are the same nothing is left out and it says "In each of".
- **The Take-home pay stays one Household figure** (ADR-0040). There is no stored figure per Parent to put the suggestion beside, so the page adds what everyone else's pay can be counted on for (`payRanges`' `countOn`, as before) and offers the sum: "Use $7,300 as your take-home pay". One press is a Plan change from the month being read on, in the Log like any other, with Undo. It is offered only when the sum is more than $25 (`EXTRA_INCOME_FROM`) from the Take-home pay, and nothing ever changes on its own.
- **One figure for one press.** While a suggestion is made this way, ADR-0057's "Use $X as what you can count on" (the lowest of three months) is not shown; with fewer than 6 months it is the only offer, as before.
- **A lean month says so** (`leanMonth`, `packages/domain/src/lean-month.ts`), on This Month's Free to Spend card and under the figures on Plan › Income, in the Household's current month, when Income is more than $25 below the Take-home pay. It is the Household's Income against the Household's Take-home pay, since that is the one figure the Plan counts on.
  - **"In so far", not "behind", until the month's last five days.** "$2,800 of the $4,000 your Plan counts on is in so far, $1,200 to go." A Parent who is paid late in the month is not behind on the 8th, and Noodle has no schedule for pay that varies to say otherwise. The five days are ADR-0040's (`LOWER_PAY_LAST_DAYS`), where "Lower take-home pay" is already offered because little more pay is due: from then it reads "October is $1,200 short of the $4,000 your Plan counts on, with 3 days left."
  - **Before those days it speaks only when Pay to come is waiting**, because then it has something to add; otherwise the page's "Still expected" already says the gap. In the last days it also speaks when a Parent has a pay history, with or without Pay to come.
  - **Pay to come is set against the gap, and still counts nowhere.** What is expected by the end of the month (one already late included) is added up with the latest of its days: "$2,500 of pay to come is expected by Oct 24, which would cover it", or "which would leave $700 to go", or "was expected by Oct 3 and isn't in yet". Pay to come with no day is said apart and not set against the gap; pay expected in a later month is not said.

## Considered

- **The lowest of the last 6 months.** Easy to say, but one late client inside six months sets the Plan for half a year, and a lean season more than six months back is forgotten. It is also barely different from the three-month figure it would replace.
- **The lowest of 12.** One month of $0 (a client who paid on the 2nd instead of the 30th) would have the Plan count on nothing.
- **An average, or the average less a margin.** Half the months come in under an average, so the Plan would be short as often as not, which is what ADR-0040 set out to avoid. A margin is a number nobody can check against the bars.
- **A percentile.** The second-lowest of twelve is near the tenth percentile; saying "second-lowest" is the same thing in words a Parent can verify by looking.
- **"Behind" from the Parent's usual arrival pattern** (how much had landed by this day in earlier months). This Month already has a line of that kind for the Household ("Income is $X behind where it usually is by now"), and it is left as it is. For one consulting Parent with a handful of payments a year there is no pattern worth the name, and a wrong "behind" on the 10th is the alarm this was asked to avoid.
- **A Take-home pay per Parent**, so the suggestion sits beside "what that Parent said". Still the migration ADR-0040 put off; the sum does the job in one press.

## Consequences

- The history reads thirteen months of money in on Plan › Income. This Month reads the Pay to come always and the history only in the month's last five days.
- A Parent whose first Income is older than twelve months and who then had months of nothing at the start of the window has those leading months left out, not counted as $0: the read does not look further back to tell.
- Everyone is "hourly, or pay that varies" until they say (ADR-0063), so a salaried Parent who has not said how they are paid gets a history too. It is true, and saying they are on a Salary removes it.
- A suggestion of $0 (two months of nothing in the window) is said as it is; the offer is then what everyone else's pay comes to.
- **Holding a better month for a lean one is not built.** Extra income can already be sent to a Goal, which holds it Set aside, so "a Goal named Lean months" can be filled today. Nothing brings it back: releasing what is Set aside changes nothing in the Plan, and a Cover draws only on a Bucket or Free to Spend. A lean month drawing on a Goal needs a Move of its own (Goal to that month's Free to Spend, or to its Take-home pay shortfall), read by `monthState`, `freeToSpendSql`, the Carry-over chain's ended months (ADR-0054 counts Goal funding against a month, and this is its opposite), Reports and the Log, and a way to say which Goal is the one for lean months that is not its name. That is a design of its own, and probably a column.
