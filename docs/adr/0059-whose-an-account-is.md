# ADR-0059: An Account has "whose Account" it is, and Accounts lists them by it

Status: accepted (2026-10-07)

## Context

Accounts was one list for the whole Household, in two parts by kind: Cash, then Cards and loans. With both Parents' checking, savings and cards in it, a Parent had to read every name to find their own. The owner asked for Accounts "organized by the person that owns the accounts" (issue 144). Nothing recorded that: an Account had a name, a kind and a Bank Connection, and a Bank Connection only who connected it.

## Decision

- **An Account has "whose Account" it is**: a Parent, or the Household. The same words and the same two answers as Income's "whose pay" (ADR-0057). Stored as a nullable Member on the Account (`accounts.whose_member_id`, migration 0086); null is the Household's. Only a Parent of the Household is accepted, never a Child.
- **A new Account is the Parent's who adds it or connects its bank**, unless they pick the other Parent or the Household on the add form. Pairing a bank account with an Account already there leaves whose it is alone.
- **An Account from before this is the Household's until a Parent says.** Nothing is guessed from its name, its bank or who connected it. Whose it is is changed on the Account's page ("Whose Account"), by either Parent, and saved as it is chosen.
- **Accounts lists a group per answer**: the Parent looking first, then the other Parent, then the Household's; a group with no Accounts isn't shown. Inside a group the order is as before (Cash, then Cards and loans, each oldest first), and the group says what its cash and what's owed add up to. The page's Totals stay the whole Household's. Archived Accounts stay in one list at the bottom.
- **It hides nothing.** Both Parents see every Account, balance and Transaction as before; the only privacy rule is still the Personal Allowance's. It doesn't change the Plan, Free to Spend, a Goal or who a Transaction is For.

## Consequences

- The word "owner" stays out of the app (CONTEXT.md avoids it for a Parent and for For); the UI says "Whose Account" and "Sam’s Accounts", "The Household’s Accounts".
- The data download's `accounts.csv` gains a "Whose" column (a Parent's name, empty for the Household's).
- A Child's own account can't be said to be the Child's yet; it sits with a Parent or the Household. That is a later decision if it is wanted.
