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
