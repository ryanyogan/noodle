# Plan on pay you can count on; Extra income can go to Free to Spend

Amends [ADR-0001](0001-layered-plan-not-zero-based.md), which kept income above the Take-home pay out of Free to Spend altogether.

In the Household this app is for, one Parent's pay is the same each month give or take a few dollars, and the other Parent's pay varies month to month. Under ADR-0001 a better month became Extra income that could only go to a Goal or one Bucket: Free to Spend never moved, so the money read as "not usable" (#86). A month a few dollars over raised a To do, and a low month left Free to Spend reading too high with nothing to do about it.

## Decision

**The Take-home pay in the Plan is the pay the Household can count on**: the fixed pay plus the lowest the varying Parent usually brings home. The Plan still does not move as paychecks land (ADR-0001 stands on that). What changes:

- **Extra income can be added to Free to Spend**, in one tap, as well as sent to a Goal or a Bucket (#86, phase 86a). It is still a Parent's choice each time, never automatic: a `windfall` Move with neither a Goal nor a Bucket, counted in that month's Free to Spend on This Month, Plan › Year and Reports. On "Close <Month>" the same choice for a month that has ended reads "Leave it in the account".
- **A few dollars is not Extra income.** Income up to $25 above the Take-home pay (`EXTRA_INCOME_FROM`) raises no To do, Nudge or Check-in card; more than $25 above, all of the difference is Extra income. A flat amount, because it is easy to say and 1% of a typical Take-home pay is more than "a few dollars".
- **A low month can be put right in one tap.** When the month's Income is more than the same $25 below the Take-home pay, a Parent can "Lower take-home pay to" what came in. It is a Plan change for "Just <Month>" (the next month goes back to the amount before), so later months keep the pay they can count on; Free to Spend falls by the same amount, and if that takes it below zero the Plan's usual "more than your take-home pay" line and Covers take over. A toast offers Undo. The step is always on Plan › Income for the current month, and on This Month's Free to Spend card only in the month's last five days, when little more pay is due; it never raises a To do or a Nudge. Income that arrives afterwards is Extra income like any other.
- Where Take-home pay is entered (Setup, Plan › Income, the Glossary) the app says to enter the amount you can count on when someone's pay varies.

## Considered

- **Pay per Parent, marked "the same each month" or "varies".** Clearer about whose pay moved, but it needs a migration (Take-home pay per Parent, Income marked with whose it is, which imports cannot tell), Setup changes and rules for the other Parent's privacy. Worth revisiting only if the Parents want to see each pay separately.
- **Plan from what actually arrives.** No Extra income decisions at all, but Free to Spend would start each month low or negative and move with every paycheck: the upkeep ADR-0001 was written to avoid.
- **Lowering the Take-home pay automatically in a low month.** Rejected: mid-month a paycheck may simply be late, and the Plan changing on its own is what ADR-0001 rules out. An ended month's Plan is closed, so the step is offered in the current month only.
