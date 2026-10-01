# Payoff Goals are measured by what's owed, and funded as planned extra payments

A Goal used to be only money Set aside on a checking or savings Account (ADR-0002). There was no way to plan paying down a credit card or a loan: the Account page for a card said "Goals are set aside in a checking or savings Account" and stopped there (#47).

A **payoff Goal** is a second kind of Goal, on one credit card or loan:

- **Target:** what's owed on the card or loan when the Goal is added. The server reads it from the Account's latest balance at that moment; a Parent doesn't type it. A card with no balance yet, or one that owes nothing, can't get one.
- **Progress:** how far what's owed has come down since: **paid down** = target − owed now, never below $0 or above the target. "Still owed" is the Account's balance as Noodle knows it.
- **Funding:** monthly from Free to Spend, like any other Goal: a Goal funding Move (and Extra income or a Sweep can go to it too). It's a plan for **extra payments**, not money kept anywhere. Nothing is Set aside in a card.
- **Done:** when what's owed reaches $0, the Goal shows "Paid off". A Parent then completes it, as with any other Goal; Noodle doesn't complete it on its own.

The rest follows from those four.

## What's owed now

What's owed is the card's or loan's balance as Noodle knows it: the latest one the bank brought in, or a Parent entered (Update what's owed), or a statement's closing balance a Parent chose to use. Nothing else moves it.

- **A card payment** (a Transfer from checking to the card) doesn't change what's owed by itself. A Transfer never counts as spending, so it doesn't touch Free to Spend either. The payment shows in what's owed when the bank brings in the card's next balance, or when a Parent updates it or uses the statement's. The payoff Goal's page offers both: "Update what's owed" and, when the card's latest statement is newer than its balance, "Use the statement's $X".
- **Funding and payments are separate on purpose.** Funding is the Plan saying "this month we'll pay $400 extra"; the payment is the money actually leaving checking. Progress only ever comes from what's owed, so funding that was never paid doesn't count as progress, and a payment that was never planned still does.
- **A regular payment Commitment** (the Honda car payment) stays a Commitment. A payoff Goal's funding is on top of it, for paying off faster, so the same money isn't planned twice. The Add Goal sheet says so.

## When the balance changes

- **It goes back up** (new charges, interest): paid down falls, to $0 at worst. Noodle shows it, rather than hiding it. The target stays what was owed when the Goal was added.
- **Start again from today's balance** sets the target to what's owed now and restarts the schedule from this month. It's on the Goal page when what's owed is above the target, and in its Edit sheet. It's a Plan change ("Goal target"), like editing a savings Goal's target.
- A payoff Goal's target can't be typed in Edit: it only ever is "what was owed". Its name and target date can be changed.
- **Paid off and then owed again** (the card is used after it's done): a completed payoff Goal stays completed. A Parent adds a new one.

## The schedule and Plan health

- **A month:** what's still owed, spread over the months to the target date (this one included): `ceil(owed / months left)`. A payment made this month lowers it at once. With no target date there's no schedule, as with savings Goals.
- **This month:** a month's amount less this month's funding.
- **Behind:** paid down is less than an even schedule from the month it was added expects by the start of this month: the same rule as a savings Goal, with paid down in place of set aside.
- **Plan health** ("won't reach it by its date"): at the pace it has been paid down since it was added (paid down ÷ months since), when what's owed would reach $0. A Goal added this month isn't judged, as before. One whose balance has gone up isn't coming down, so it's flagged.

## Where it shows

- **Goals:** a "Paying off" group above "Saving for": "Paid down $X · $Y still owed", with the Account named.
- **The Goal page:** "Paid down $X of $Y", "Still owed $Z", a month and this month, its target date; Fund, Update what's owed and the statement's balance; History with both its funding and what was owed over time; Complete once paid off; Archive. There's no Spend, Set aside or Release, and it can't be the emergency Goal.
- **The Account page** for a card or loan: "Plan to pay this off" adds one; once there is one, it shows its progress and links to it.
- **Plan › Goals and This Month:** rows like other Goals ("$400 left to fund this month"), with Fund saying "Plans extra payments on <card> from this month's Free to Spend". Its funding counts in Goal funding and Free to Spend like any other.
- **Explore and the year view:** projected like other dated Goals, as if each month's funding is paid to the card: its monthly amount comes out of Free to Spend until what's owed would reach $0. Goal paths show paid down rising to the target.
- **Reports** (Goals): paid down of the target, and when it'll be paid off at its pace.
- **Ask:** its Goals answer lists payoff Goals with what's owed and paid down.
- **Can we afford it?:** a payoff Goal holds no money, so it isn't offered as savings to use.

## One per card or loan

A card or loan has at most one active payoff Goal (a partial unique index on `goals(account_id)` for `kind = 'payoff'` that's neither completed nor archived). Two would split one balance between them with no way to say whose payment was whose. A completed or archived one doesn't block a new one.

## Storage

`goals.kind` is `'save'` (the default, every Goal before this) or `'payoff'`. `goals.account_id` is the card or loan. No new table: the target is `target_cents`, funding is the existing Goal funding Moves, and what's owed is `account_balances`. A payoff Goal never has an `earmark_claims` row or Goal spending; the database refuses both.

## Considered

- **Progress from payments** (the Transfers into the card since the Goal was added). Rejected: a card paid in full each month would show the month's purchases paid off as "progress"; a card entered by hand often has no Transfers; and it would make a Transfer count for something, which nothing else does.
- **A target that follows the live balance** ("pay off whatever's owed"), with progress as funding. Rejected: the target would jump with every charge, and funding that was planned but never paid would show as progress.
- **Funding that sets money aside in checking** for the payment (a savings Goal "for the card"). Rejected: it reads as two Goals for one thing, and the money's real home is the card.
- **Completing it automatically at $0.** Rejected: the user's decision is that a Parent completes it, as with other Goals; a bank's balance can read $0 for a day before a pending charge posts.
- **Several payoff Goals on one card.** Rejected, see above.
- **Interest (APR), minimum payments and payoff order** (snowball, avalanche). Left out: they need rates Noodle doesn't have. A later ticket can add them.

## Sources

- Monarch, Pay Down Goals: "Your pay down dashboard tracks progress using your real account balances". It admits double counting a card's payments as "a known limitation". https://help.monarch.com/hc/en-us/articles/44373293932052-Using-Pay-Down-Goals
- YNAB, loan targets: "Any debt added to the loan account means you'll need to delete and create a new Debt Payment target". That's our "Start again from today's balance". https://support.ynab.com/en_us/paired-targets-BJJI8rdC5.md
- YNAB, paying down a card over time: plan a set amount monthly; new spending on the card is "rolled into the existing balance". https://support.ynab.com/en_us/paying-down-a-credit-card-balance-over-time-SkWj0Ls8Me.md
- EveryDollar: "Simply entering the payment will not keep your debts in sync … Banks and creditors charge fees and interest", so balances are what count. https://everydollar.help.ramseysolutions.com/hc/en-us/articles/16020894846093-How-to-Update-a-Debt-Balance
- Goodbudget, debt accounts: "you'll see the red bar get shorter and shorter until it disappears!" https://goodbudget.com/help/using-accounts/create-debt-account/
- CFPB, reducing debt worksheet: the columns "Amount still owed", "Monthly payment", "Extra payment" and "Date paid off in full", and the two payoff orders left for later. https://files.consumerfinance.gov/f/documents/cfpb_ymyg-toolkit_reducing-debt-worksheet.pdf
