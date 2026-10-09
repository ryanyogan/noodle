# ADR-0058: Paid back and Owed back, for money from outside the Household

Status: accepted (2026-10-06), revised 2026-10-08 (see the end)

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

## Revised 2026-10-08: what's owed back never counts as our spending

The owner has reversed "it counts in the month it arrives" (issue 158). Counting the whole purchase until the money came made a Bucket read over for weeks for money that was never the Household's to spend, and it made the month's spending and Free to Spend depend on when someone else paid. What the owner wants is that what's owed back never counts against a Bucket or the month.

- **Only the Household's share counts.** The Owed back part of a purchase (or of a Split) is not spending from the day it is said: not against its Bucket or Commitment, not in the month's spending or in what a Bucket carries over, not in Free to Spend, Reports (by Bucket, by day, by who it was For, and narrowed), the Check-in or the Transactions list's total. It takes the purchase's own day, so a purchase and its Owed back part are always in the same month.
- **The purchase is still shown whole.** Its row keeps its full amount and says the part owed ("$600 · $300 owed back by Casey", and "Paid back by Casey" once all of it has come). Each Bucket and Commitment that has any, and the month, say an **Owed back** total apart from spending.
- **Paid back money settles the item and changes nothing in the Bucket**, since that part never counted. Money beyond what is owed still waits as "Paid back, not matched yet" and is never Income.
- **Months that had ended are not changed.** The rule goes by the purchase's day, with one fixed day: a purchase dated **October 1, 2026 or later** counts only the Household's share; a purchase dated before that counts whole, as its month was counted, and what is Paid back on it still restores its Bucket or Commitment in the month the money arrives, exactly as decided above. October 2026 was the running month when this was decided, so no ended month's figures and no carried-over Free to Spend (ADR-0054) move. The day is fixed, never "the running month": a month counted one way is never counted the other way later.
- **Nothing recorded is rewritten.** The counting is derived when read from the Owed back items and the purchase's day; there is no migration. A match on a purchase from October 1 on keeps its `counts_on` day, which no figure reads.

"Count only the Household's share from the start" was considered and rejected above because it hides money that has really left the Account. The row at its full amount and the Owed back totals are what keep it in sight.

### Writing it off (issue 158, phase b)

Something never paid stays Owed back, and uncounted, for as long as nobody says otherwise. No date makes it spending by itself.

- **A Parent writes it off**, from the Owed back list or from the item on its purchase: all of what is still owed, so the rest of an item after a part payment. The item leaves the open list and is listed under "Written off".
- **It counts as the Household's spending in the month it is written off**, on the day it is written off, in the purchase's Bucket or Commitment (the Split's, when it was said on a Split): in the month's spending, what a Bucket carries over, Free to Spend, Reports and the Check-in, through the same reads that leave the Owed back part out. The purchase's own month is never touched, so an ended month does not change.
- **It can be undone while the month it was written off in is running**, and the item is then Owed back again. Once that month has ended it stays written off, the item cannot be taken off, and the purchase is held as one with money back that counted in an ended month.
- **While written off, who and how much do not change.** The write-off is undone first.
- **A purchase dated before October 1, 2026 counted whole already**, so writing off what is owed on it only closes the item and counts nothing more.
- **Stored on the item**: `owed_back.written_off_on` (the day) and `written_off_cents` (what was still owed then), both null until written off (migration 0093). Kept as an amount so a later change to what was Paid back never changes what an ended month counted.
