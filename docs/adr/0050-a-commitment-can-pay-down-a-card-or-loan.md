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

"It's a card payment" reads the same answer: bank or statements is a Transfer; `none` (or not asked) files it in the Commitment that pays the card down when there is one. Snapshots carry the new columns and `capture_cards` by name (ADR-0048); the Household's export still lists an Account's name, kind, balance and owed, not how its purchases get in.
