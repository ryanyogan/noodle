# A Commitment can pay down a card or loan

Status: accepted (2026-10-05, issue 93). Amends ADR-0019.

## Context

A Household pays some cards and loans from checking without Noodle ever seeing the other side: a car loan kept by hand, an American Express that isn't connected. The payment leaves checking every month, so it is planned as a Commitment, and it is real spending (what was bought on that card reached no Bucket). But ADR-0019 said what's owed is only ever the latest balance the bank brought in or a Parent typed: "Nothing else moves it." So a Parent who paid $500 on the car loan saw the Commitment paid and the loan still owing what it owed last month, until they typed a new figure.

The rule a Parent can hold: **if Noodle sees what you buy on a card, paying it is a Transfer and isn't spending; if it doesn't, the payment is the spending, so plan it as a Commitment.**

## Decision

**A Commitment may name the credit card or loan its payments pay down** (`commitments.account_id`, null for none). It is on the Commitment, not its terms: it doesn't change month by month.

**What's owed on an Account kept by hand is its latest balance, less the payments filed in Commitments that pay it down and dated after the balance's day** (`owedOn` in `@noodle/domain`, `owedSql` its SQL twin).

- **Nothing is written when a payment is filed.** What's owed is derived, as an Account's balance already is from Goal spending (ADR-0002). Un-filing, deleting or undoing a payment, marking it a Transfer, or unlinking the Commitment puts what's owed back with no further write.
- **By the payment's date, not when it was imported.** A balance has a day it was true (`account_balances.as_of`): a statement's closing date, or the day a Parent typed it. Rows from before this, and a bank's balances, have none and count as of the day they were recorded, in the Household's time zone.
- **A payment on the balance's own day is already in it.** A Parent who pays and then types what the card's site shows hasn't paid twice. Only later days come off.
- **A later statement or typed balance supersedes every payment before it.** It is the new starting point.
- **A connected Account is never derived.** Its bank's balance wins, and the bank already knows about the payment.
- **For the whole Household.** A Commitment has no owner (ADR-0030), so both Parents see the same figure.

Every reader of what's owed uses this one figure: the Account page and list, a payoff Goal's target, progress and "Start again from today's balance", the Year, Reports' and Ask's Goal progress, Scenarios' projection, and setup.

**A card Noodle follows can only be linked as a balance being carried.** A card is followed when it syncs with its bank or a purchase was imported into it in the last 60 days: what's bought on it is already in Buckets, so a Commitment for its payment would count that spending twice. The server works this out at write time; saving the link then needs the Parent's deliberate choice, stored as `commitments.carried_balance` ("This is a set payment on a balance I'm carrying"). A loan, and a card Noodle doesn't follow, link freely.

**The link's guards:** the Account is the Household's, a credit card or loan, and not archived (ADR-0046). The change is a Plan change of its own kind, "commitment-account", naming the card or loan before and after.

**An Account a Commitment still in the Plan pays down can't be archived**, as with one a Goal is kept in (ADR-0046): its payments would bring down what's owed on an Account no screen shows. The Parent ends the Commitment or changes what it pays down first. An ended Commitment doesn't hold it.

**Filed or Transfer, never both.** A Transaction that is a side of a Transfer counts nowhere (the one rule in `counts`), so it takes nothing off what's owed either.

## Consequences

- ADR-0019's "Nothing else moves it" no longer holds for an Account kept by hand with a Commitment paying it down. Its other rules stand: a payoff Goal's progress still comes only from what's owed.
- **On a card still in use, what's owed drifts low** between balances: new purchases and interest aren't in it until a Parent updates it or uses a statement. The app says so where it shows the figure.
- A payoff Goal's history still lists the balances entered; the payments between them are read from `loadGoals`' `payments`.
- The Household's data export still lists each Account's latest entered balance, not the derived figure.
- Snapshots (ADR-0035): `commitments` now points at `accounts`, so Bank Connections, Accounts and their balances are restored (and seeded) before Commitments, and cleared after them. A snapshot from before this restores with no Commitment linked and no balance dated, which is what it held.
- Free to Spend is untouched: it still counts a Commitment's planned amount, whatever was paid.

## After the link: a card that becomes followed, the amount, and the shortest phones (phase D)

- **A linked card that Noodle begins to follow.** The link is never undone behind a Parent's back. Plan health gains one check (`cardsNowFollowed` in `packages/domain/src/plan-health.ts`): a Commitment in this month's Plan that pays down a credit card Noodle follows (connected, or a purchase imported in the last 60 days) and has no `carried_balance`. It reads "American Express is connected now, so its payments would count twice." (for a card followed through imported purchases: "Noodle sees what's bought on American Express now, …"), with two buttons on the row: "End this Commitment" (the usual end, asked once) and "Keep it: it's for a balance I'm carrying" (sets `carried_balance` through `linkCommitment`'s guard). Until a Parent answers, Review keeps treating that card's payments as Transfers (case b). It counts in This Month's "things to check in the Plan" like any other warning.
- **The amount is suggested, never set.** With a card or loan chosen under "Pays down", the add form shows what the payments to it came to a month over the last three full months, found by the same reading as Review's cards (`paymentsTo` asks `paymentCase` which lines it would file in a Commitment paying that Account down): "About $2,300 a month across 9 payments" and "Use $2,300". The average runs from the first of those months with a payment; it is rounded to $10 ($1 under $100), or given to the cent when every month came to the same total. Payments in fewer than two of the months suggest nothing. A line already marked a Transfer still counts: it was a payment to the card.
- **Suggestions (ADR-0027) still leave card and loan payment lines out** (`isMoneyMovement`). `spotCommitments` reads merchants only: it cannot tell a card Noodle follows from one it doesn't, and payments like the Amex pattern have no cadence for it to find. A payment to a card Noodle doesn't follow already has its way to a Commitment on its Review card ("Make it a Commitment"), which now arrives with the amount suggested.
- **Review on the shortest phones.** A payment card's "why" is the second line of its grey panel, naming the card when the line does ("Noodle can't see what was bought on Discover it, so the payment is the spending."); the separate "Looks like a payment to …" line is gone. Under 360px wide the panel drops its tile and shows the why alone (its title is still read out), the card's name keeps to one line, and a card Noodle doesn't follow has no third row: "Connect the card" ends the why as a link and "It's a card payment" sits beside the picker. That leaves Skip and Undo above the bottom bar at 320×640.
- **The export's Accounts file** has "Owed now" beside "Balance": the balance last entered, and that less the payments filed since, as the app shows it.

## A card kept by hand (issue 136, spec 130 item 8)

"Kept by hand" above meant only "no Bank Connection", and what's owed moved only with Commitment payments. A credit card now says how its purchases get in (`accounts.purchases`: `statements`, `hand`, `none`; null until asked), and for `hand` with no Bank Connection what's owed moves with more:

- every line on the card dated after the balance's day goes on (a Quick Add picked "Paid with" the card, a Wallet capture naming it, an imported line; a Quick Add Matched with a statement line gives way to the line), and money back comes off;
- a payment marked as a Transfer naming the card (`transfers.other_account_id`, one-sided) comes off, beside the Commitment payments this ADR already takes off. The card's page lists both under Payments.
- The monthly balance check (`accounts.statement_day`, `checkStatementBalance`) replaces "what's owed drifts low" for these cards: the statement's balance is compared with what's recorded up to its day and then taken as the balance.

"It's a card payment" reads the same answer: bank, statements or hand is a Transfer; `none` (or not asked, with nothing seen on the card lately) files it in the Commitment that pays the card down when there is one. (Corrected 2026-10-07, see the note below: the code had `hand` filing in the Commitment.) Snapshots carry the new columns and `capture_cards` by name (ADR-0048); the Household's export still lists an Account's name, kind, balance and owed, not how its purchases get in.

## Note, 2026-10-07: a card kept by hand is followed (issue 151)

**What the code did.** "Followed" meant only a Bank Connection or a purchase imported in the last 60 days. A card answered `hand` (or never asked, with Quick Adds or Wallet captures on it) was therefore not followed: Review read its payment as "Payment to a card Noodle doesn't follow" with **Make it a Commitment** first, or filed it in the Commitment already paying the card down; `cardPaymentIsSpending` said the same for "It's a card payment"; a Commitment could be linked to the card without the carried-balance tick; Plan health was silent.

**Why that was wrong.** Such a card's purchases are in Buckets already. The payment filed in a Commitment counted them a second time: spending too high by the payment, and Free to Spend too low by the Commitment's amount every month it stayed in the Plan. CONTEXT.md and this ADR already said a card kept by hand is paid by a Transfer naming it.

**What changed** (going forward only; nothing already filed is rewritten):

- `followedSql` (and so `followedCards`, `mayPayDown`, `commitmentLink`, Review, the "Pays down" form and Plan health) also follows a card answered `hand`, and a card never asked about with a purchase put on it in the last 60 days from any source. A card answered `none` is followed only by an import, as before. We chose this over asking "How do its purchases get in?" inside Review: the question is still asked on Accounts and the card's page, and nothing is guessed into `accounts.purchases`.
- `cardPaymentIsSpending` is true only for `none`, or for a card never asked about that isn't followed. So Review and "It's a card payment" agree for a `hand` card with a statement imported lately too.
- An existing Commitment linked to such a card without the carried-balance tick is named by Plan health's "would count twice" row, with its two ways out (end it, or keep it for a balance being carried). Review reads the card's payments as "Card payment — not spending" and says the payment is no longer filed in that Commitment.
- A Rule that files into such a Commitment (stated by an earlier "Make it a Commitment") is kept but not applied (`countingTwice`: on Import, on a capture, on looking again at Review, and by "apply this Rule"): its lines wait in Review with no guess. Ending the Commitment or ticking "a balance I'm carrying" is the repair; the Rule applies again once the Commitment is for a carried balance.
- A payment line that says "APPLECARD" as one word is read as naming an Account called "Apple Card".

Payments already filed in such a Commitment, and the months they are in, stay as they are until a Parent changes them.

## A loan's facts, and its Commitment added with it (issue 153, phase b)

- **A loan's facts are on its Account** (`accounts.borrowed_cents`, `payment_cents`, `due_day`, `ends_on`; all null until said). The day of the last payment is what is stored; the form asks "Payments left" and turns it into that day, and how many are left is always worked out again (`loanSchedule` in `@noodle/domain`), so the two can't disagree. Nothing is per lender: several instalment plans at one lender are several loan Accounts.
- **The payments to come are derived, with no interest**: what's owed (this ADR's figure), monthly on the due day at the payment, the last being the remainder. When a payment and an end are both said, the payment decides and the page says where the two differ. A payment dated this month moves the next one to next month.
- **"Add a monthly Commitment for its payments"** on the add-Account form, on to start with for a loan and for a credit card answered "They won't" (`purchases = none`): the Account, its balance and a monthly Commitment that pays it down are one batch, and one Plan change ("commitment-add", carrying `paysDown`). Any other card is paid by a Transfer, so it isn't offered; a set payment on a carried balance is still linked from the Commitment's own form. The Account's page offers the same while no Commitment in the Plan pays it down (`addPaymentCommitment`, refused when one does, or for a card Noodle follows).
- **A loan with a payoff Goal** keeps both: the schedule is the regular payment, the Goal's funding is extra on top (ADR-0019). Both read the same what's owed.

## A payment to a loan's lender (issue 153, phase c)

- **A line names a loan when it says nothing else.** Money out whose telling words (the bank's wording, or the merchant's name) are all in the name of a loan a Commitment in that month's Plan pays down, or in that Commitment's name, is a payment to its lender (`loansNamed` in `@noodle/domain`). Sharing one word is not enough ("SOFA WAREHOUSE" is not "Zipline sofa"), and no list of lenders is kept.
- **Several loans at one lender are told apart by the amount** (`loanByAmount`): the loan whose payment it is to the cent (`accounts.payment_cents`, else the Commitment's amount), else the nearest. Review suggests that loan's Commitment ("Looks like a payment on …"); when two have the same payment or are as near, it asks which, listing each with its payment.
- **On arrival it is never filed in a Bucket** by a merchant filed before or by the model: it waits in Review for that suggestion, unless a Rule files it.
- **A Rule into a loan's Commitment is a Rule for the lender.** No amount is stored on the Rule: each time a line it matches arrives (and when the Rule is applied to what waits), the amount is matched again among the loans the line mentions (`ruledLoanPayment`). An exact payment files in that loan's Commitment, whichever loan the Rule was made on; any other amount waits in Review. With one loan at the lender the Rule files as stated, whatever the amount. We chose this over an amount on the Rule: it needs no migration, one Rule covers every loan at the lender, and it follows a loan's payment when a Parent changes it.
- **Counted once.** A loan's payment made with a credit card is a purchase on the card filed in the loan's Commitment and in no Bucket; the card's own payment stays a Transfer.

## A loan paid off, its end, and its Commitment's terms (issue 153, phase d)

- **Paid off is worked out on read, never written.** The day a loan was paid off is the day what's owed came to $0 or under and stayed there (`loanPaidOffOn`: the payment that brought it there, or the balance's own day). `loadPlanRecords` reads each Commitment that pays down such a loan as ended from the month after (`endedOrPaidOff`, with `paidOffOn` beside it), so every reader of the Plan (This Month, Free to Spend, Plan › Commitments, Coming up, the Year, Reports, Ask) stops planning it from the next month and still plans it once in the month it was paid. We chose this over writing an end with the payment: a payment is filed, moved, split, deleted, undone and marked a Transfer from many places, and what's owed is already derived for the same reason. Deleting or moving the payment, or a balance above $0, plans the Commitment again with no further write.
- **A Parent's own end is never touched.** `commitments.ended_from_month` stays as they set it; the Plan reads the earlier of the two. So a later end comes back if the loan owes again.
- **Only what is planned changes.** The guards that read the stored end (filing a payment in the Commitment, the pickers, archiving the Account) still see the Commitment, so a late or corrected payment can be filed in it; a paid-off loan is archived after its Commitment is ended, as before. A credit card's Commitment is never ended this way: a card at $0 is still in use.
- **Real payments decide the end, not the schedule.** A loan's Commitment stays in the Plan while anything is owed, also past the day a Parent said it ends (`accounts.ends_on`): the loan's page then says its last payment was to be that day and what is still owed. The issue's "ends from the month after its last scheduled payment" would have let a bill with money owed leave the Plan unseen.
- **One source for the payment and due day.** While a monthly Commitment in the Plan pays a loan down, the loan's page reads its payment and due day from that Commitment's terms in force this month (`loanInStep`); `accounts.payment_cents` and `due_day` are what stands when there is none. Saving them on the loan writes both, the Commitment's terms from this month on, in one batch and one Plan change ("commitment-terms"), undone like any other; the form then needs a payment and a due day. Editing the Commitment writes nothing to the loan.
- **Payments against the schedule** (`paymentSchedule`): one row a month from the first payment made, judged by that month's payments together, then the payments to come from what's owed. The Payments section keeps its first line and leaves the list to the schedule when the schedule shows every payment.
- **With a payoff Goal** both read the same what's owed; where "Paid so far" (from what was borrowed) and the Goal's progress (from what was owed when it began) differ, the loan's page says in one line why.
