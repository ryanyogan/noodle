# ADR-0058: Paid back and Owed back, for money from outside the Household

Status: accepted (2026-10-06)

## Context

The Parents pay for things that someone outside the Household's pool of money pays back: a Child's other parent pays part of tuition and gear, usually as a lump sum covering several purchases; a Child pays for their own purchase from their own checking account. Neither is a Refund (the merchant returns nothing) nor Between us (the payer is not a Parent), and as Income it inflated the month.

## Decision

- **Owed back** is said on a purchase (or a Split): who, a name and not a Member, and how much, half unless said or remembered. A Rule can remember it ("Tuition: Casey pays back half").
- **Paid back** is money in of that kind (ADR-0057). It is applied to open Owed back items, oldest first as an offer, and nothing is applied until a Parent confirms. One payment can settle several purchases; a purchase can stay partly owed; anything beyond what is owed waits as "Paid back, not matched yet" and is never Income.
- **It counts in the month it arrives**, restoring the Bucket or Commitment of each purchase, the way a Refund does. An ended month is never changed afterwards. A Commitment someone shares is planned at the Household's share, and reads "$600 over · $600 owed back by Casey" until the money comes.
- **A Child's own account is not an Account.** It is the Child's money. Allowance going to it is spending (a Commitment, For that Child); money coming back from it is Paid back by that Child.

## Considered

- **Correct the purchase's month when the money arrives.** Truer per month, but closed months would change after the fact and carried-over Free to Spend (ADR-0054) would move under the Parents.
- **Count only the Household's share from the start.** Hides money that has really left the Account until, and unless, it is paid back.
- **Children's accounts as Accounts kept by hand.** Answers "how much does she have", at the cost of two balances kept by hand forever and every allowance becoming a Transfer.
- **A person owing money as a Member or an Account.** Casey is not in the Household and holds none of its money; a name is enough.

## Consequences

- Noodle cannot say what a Child has in their account.
- What someone owes is a list ("Owed back"), not a balance: it is only as complete as the purchases a Parent marked.
