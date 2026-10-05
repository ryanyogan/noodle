# Noodle

A household budgeting tool for a family (two parents, two kids) that layers a simple monthly plan over real spending, so the day-to-day only asks for attention where it matters.

## Language

The Parents are new to budgeting, so these words are plain ones (ADR-0018). Where a kept term first appears in the app, a help popover explains it in a sentence and opens the Glossary, which explains every term below that a Parent sees. The Glossary opens over any page from a help icon, and is also a page of its own.

### The Plan

**Plan**:
The Household's allocation of one month's Take-home pay across Commitments, Buckets, and Goals. Each month's Plan starts as a copy of the previous one.
_Avoid_: Budget (as a noun for the whole thing), spending plan

**From <Month> on**:
How far a change to an amount in the Plan (the Take-home pay, a Bucket's allowance, a Commitment's amount) reaches by default: that month and every later month, unless a later month has its own amount.
_Avoid_: Permanently, going forward, default

**Just <Month>**:
A change to an amount in the Plan for that one month: the month after goes back to the amount before the change, unless it has its own.
_Avoid_: One-off, temporary, override, this month only

**Changed this month**:
An amount in a month's Plan that differs from the month before's, shown with what it was ("Changed this month · was $900").
_Avoid_: Modified, edited, overridden

**Plan change**:
One change a Parent made to the Plan (the Take-home pay, an allowance, Resets monthly or Carries over, new Commitment terms, a Goal’s target; a Bucket, Commitment or Goal added; a Bucket or Commitment renamed, archived or ended), kept with who made it, when, the month it takes effect and what it was before. "What changed" on the Plan nets a month's Plan changes per item; the other Parent's Personal Allowance only ever reads as "Personal Allowance changed".
_Avoid_: Edit, audit entry, revision

**Commitment**:
A fixed obligation the Household has signed up to and pays on a schedule, usually monthly: rent or mortgage, a car payment or other loan, insurance, utilities (electric, gas, water, trash), phone, internet and TV, childcare and tuition, memberships and subscriptions. It is not day-to-day spending that happens to repeat, like fast food, coffee, groceries, fuel or small shop purchases: those belong in Buckets. A Commitment may **pay down** one credit card or loan (ADR-0050): each payment filed in it then brings **what's owed** on that Account down, when the Account is kept by hand. A card Noodle follows (it syncs with its bank, or its purchases were imported in the last 60 days) can only be paid down this way as a balance the Household is carrying, since paying such a card is a Transfer.
_Avoid_: Bill, fixed expense, recurring

**Coming up**:
The Commitments due from today through the next 30 days, by due date, each paid, partly paid, or due from the charges recorded against it in its month.
_Avoid_: Upcoming bills, schedule

**Yearly cost**:
What a Commitment takes in a year at its current terms (12 monthly, 26 biweekly, or 1 annual payment); its monthly equivalent is a twelfth of that.
_Avoid_: Annual cost, annualized

**Lumpy month**:
A month whose Free to Spend is lower because an annual Commitment is due in it, or a biweekly one is due three times.
_Avoid_: Spike, expensive month

**Plan health**:
The warnings on the Plan overview about the Plan as it stands, each linking to its fix: a month ahead whose Free to Spend goes below zero, income running behind the Take-home pay, a Bucket over its allowance most months (never the other Parent's Personal Allowance), and a Goal that won't reach its target by its date at its current funding.
_Avoid_: Alerts, budget score

**Bucket**:
A monthly allowance for discretionary, variable spending (Hockey, Fun, Life, Groceries), tracked as "amount left." Every Bucket either Resets monthly or Carries over.
_Avoid_: Envelope, category, budget line

**Carries over** (a Bucket that carries over):
A Bucket whose unspent amount carries into the next month, and whose overspending comes out of the next month.
_Avoid_: Rolling, Rolling Bucket, rollover category, accumulating

**Resets monthly** (a Bucket that resets monthly):
A Bucket that starts each month at its allowance; any leftover is offered as a Sweep. A new Bucket resets monthly unless a Parent says otherwise.
_Avoid_: Fresh-start, Fresh-start Bucket, use-it-or-lose-it

**Personal Allowance**:
A Bucket belonging to one Parent whose individual Transactions are private to that Parent; the other Parent sees only its totals.
_Avoid_: Fun money, private bucket, hidden spending

**Available**:
What a Bucket has to spend this month: its allowance ("planned"), plus what carried over from last month (less, if a Bucket that carries over was overspent), plus or minus what was Moved in or out. "Left" is Available less what's been spent; the month-end Left of a Bucket that carries over is its balance, carried into the next month.
_Avoid_: Budget, total, remaining

**Goal**:
A target amount (optionally with a target date) the Household funds over time from Free to Spend. Most Goals save: to keep (savings) or to spend on a known future big expense, with their money Set aside on one checking or savings Account. A payoff Goal pays down a credit card or loan instead.
_Avoid_: Sinking fund, savings bucket, pot

**Payoff Goal** (in the app, "Pay off a card or loan"):
A Goal to pay a credit card or loan down to $0 (ADR-0019). Its target is what was owed when it was added; it's **paid down** by how far what's owed has come down since (never below $0), and it's **paid off** when what's owed reaches $0, after which a Parent completes it. Its funding is a plan for extra payments, on top of any regular payment Commitment; nothing is Set aside for it. A card payment (a Transfer) shows in it once the card's balance does. A card or loan has at most one active payoff Goal.
_Avoid_: Debt goal, pay-down goal, debt snowball

**Pays down** (on a Commitment):
The label for the credit card or loan a Commitment's payments bring down ("Pays down American Express"); "Nothing" when it has none. A card Noodle follows can be chosen only with "This is a set payment on a balance I'm carrying". On the Commitment's page its Charges read "Payments", with "Still owed" beside them. Bills on This Month carry the same "Pays down" line. When the add form has a card or loan chosen, it offers a monthly amount from the payments to it over the last three full months ("About $2,300 a month across 9 payments", with "Use $2,300"); nothing is offered when payments fall in fewer than two of those months. If the card later becomes one Noodle follows and the Commitment isn't for a carried balance, **Plan health** lists it under "Things to check" ("American Express is connected now, so its payments would count twice.") with "End this Commitment" and "Keep it: it's for a balance I'm carrying".
_Avoid_: Paid to, linked account

**What's owed** (on a credit card or loan):
The card's or loan's balance as Noodle knows it: the latest one its bank brought in, a Parent entered, or a Parent took from a statement. On an Account kept by hand, the payments filed since that balance's day in a Commitment that pays it down come off it (ADR-0050); a payment on the balance's own day is taken as already in it, and a connected Account's is always its bank's.
_Avoid_: Debt, principal, outstanding balance

**Set aside**:
The part of a real Account's balance a Goal holds ("Emergency fund has $5,000 set aside"). Setting money aside, or releasing it, changes nothing in the Plan.
_Avoid_: Earmark, earmarked, allocation, sub-account, virtual account

**Not set aside**:
The part of an Account's balance no Goal holds ("$3,000 not set aside"); new Goals are Set aside from it.
_Avoid_: Unclaimed, available for goals, unallocated

**Take-home pay**:
The Household's usual monthly pay after taxes and deductions, which the Plan is built on: the pay it can count on. When a Parent's pay varies, that is the lowest it usually is (added to the other Parent's), so a better month shows up as Extra income (ADR-0040).
In a low month (Income more than $25 below it) a Parent can lower Just that month's Take-home pay to the Income that came in, which lowers that month's Free to Spend by the same amount; it is never lowered on its own. The app says "Lower take-home pay to $4,400".
_Avoid_: Baseline, expected income, salary, budgeted income, gross income

**Extra income**:
Income received beyond the Take-home pay in a month (the better month of a Parent whose pay varies, a third paycheck, a bonus, a tax refund), awaiting a decision on where it goes.
Income up to $25 above the Take-home pay is the usual pay landing a few dollars different, not Extra income. A Parent sends Extra income to a Goal, to a Bucket, or adds it to that month's Free to Spend; it never gets there on its own. For a month that has ended, adding it to Free to Spend is said as "Leave it in the account" on "Close <Month>".
_Avoid_: Windfall, surplus, bonus

**Free to Spend**:
Money in the current Plan not yet assigned to any Commitment, Bucket, or Goal: the Take-home pay, plus any Extra income a Parent added and anything carried over from last month, less what's assigned.
_Avoid_: Unallocated, leftover, safe-to-spend

**Builds up** (Free to Spend that builds up):
What a month's Free to Spend ends with, when above zero, is carried over into the next month's. Off until a Parent turns it on, and from that month only; otherwise Free to Spend **starts fresh** each month. A month that ends below zero carries nothing. What is carried is worked out from the months themselves, never stored (ADR-0054).
The Household's **Keep back** amount is what of a month's leftover is not offered to a Goal when the month closes; it builds up like the rest.
The app says "builds up" and "carried over". Sending the leftover to a Goal is Goal funding, not a Sweep.
_Avoid_: Rollover, Sweep, savings pot, surplus

**Move**:
A reassignment of planned money from one place in the Plan to another, without any real money leaving an Account. Cover, Sweep, and Goal funding are all Moves.
_Avoid_: Transfer, reallocation, adjustment

**Cover**:
A Move that brings an overspent Bucket back to zero from another Bucket or Free to Spend within the same month.
_Avoid_: Rebalance, borrow

**Sweep**:
A Move of the month-end leftover of a Bucket that resets monthly into a Goal.
_Avoid_: Rollover, save leftovers

**Month-close**:
Deciding, once a month has ended, where the leftovers of its Buckets that reset monthly are Swept and where its pending Extra income goes: by a Parent in the next month's first week, or by the defaults when nobody does. The ended month then shows how it ended: its Sweeps, the Extra income it sent to Goals, what each Bucket that carries over took into the next month, and who closed it.
The app says "Close <Month>" and "How <Month> ended".
_Avoid_: Rollover, reconciliation, closing the books

### Money movement

**Account**:
A real-world place money lives or is owed: a checking/savings account, credit card, line of credit, or loan.
A Parent can **archive** one they no longer use (ADR-0046): it leaves the Accounts list, the pickers and the totals, and nothing new is brought into it. Its Transactions and history stay as they are, so past months don't change. "Restore", under Archived on Accounts, brings it back. An Account a Goal that isn't archived is kept in can't be archived until the Goal is.
_Avoid_: Bank, card (as a generic term); delete, close, hide (for archive)

**Transaction**:
A single movement of real money in or out of an Account. It is assigned as a whole, or through Splits, to Buckets, Commitments, or Goals.
A Parent's change to one is made on the version of it they were looking at: if it has changed on another screen since (the other Parent's, another tab, the bank), the change is left out and they are shown how it looks now (ADR-0041).
A Transaction's **name** is what the lists show it by. One added by hand is named by what the Parent typed. One from a bank or a statement keeps the **bank's wording** ("AMERICAN EXPRESS ACH PMT M8054 WEB ID: 2005032111") untouched underneath, and is named, strongest first: by the name a Parent gave its merchant, by the name background AI settled, by the bank's wording cleaned ("American Express payment"). A Parent can rename any Transaction; "Use the bank's name" puts the cleaned wording back. After renaming one from a bank they are asked once whether to call the merchant's others the same, which is then remembered for later Imports. Rules and Review go by the bank's wording, so a rename never unfiles anything (ADR-0043).
Any Transaction a Parent may change can be deleted, one at a time (with an Undo for ten seconds) or many at once from the Transactions page's **Select** mode: these ones, or everything the filters match in a month or up to the end of it. Before many go, Noodle states what that touches and takes a snapshot ("Before deleting Transactions"). One that came from a bank or a statement is never brought in again (ADR-0045). Goal spending is deleted only from its Goal; money in (income) is not a Transaction and is removed from Income.
_Avoid_: Expense, entry, purchase; description, payee, memo (for the name or the bank's wording)

**Split**:
A portion of one Transaction with its own amount, assignment, and For (e.g. one Costco trip split across Groceries and Hockey).
_Avoid_: Line item, sub-transaction

**Transfer**:
A Transaction pair that moves real money between two of the Household's own Accounts (e.g. paying the credit card). Never counts as spending.
Paying the card is a Transfer, never a Bucket's spending: what was bought on the card was filed when it was bought. Where only one side is in Noodle (the other Account isn't followed), a Parent marks that side alone; a line whose words say it pays a credit card is offered as one in Review, never marked or filed on its own (#91).
_Avoid_: Payment, Move

**Between us**:
Money one Parent moved to the other. It isn't Income and it isn't spending. When both Parents' Accounts are in Noodle the two sides pair as an ordinary Transfer; when only one side is (the other Parent's Account isn't followed), a Parent marks that side as "Between us": a one-sided Transfer with that reason, for money in (a deposit, which then leaves Income and Extra income) or money out (ADR-0052). Money out whose wording reads person to person (Zelle, Venmo, PayPal, Cash App, Apple Cash) or names a Parent is offered as "It’s between us" first in Review, a Bucket second. Never marked automatically. Refused for money in while Extra income already decided in its month would no longer be covered without it, as removing that income would be.
_Avoid_: Internal transfer, reimbursement, gift

**Refund**:
Money returned for a prior purchase; it restores the Bucket the purchase came from.
_Avoid_: Credit, return, income

**Quick Add**:
A Transaction entered by hand at the moment of spending, before any bank data exists for it. One the Parent's iPhone Shortcut captures when they pay with Wallet (tap to capture) is a Quick Add too; it is filed the way imported Transactions are (by Rule, similar merchant, or the model), else goes to Review.
Quick Add can be filled in by snapping a paper Receipt or by saying or typing a phrase ("forty on pizza after hockey"): the amount, a suggested Bucket, For and a note are read for the Parent to check, and nothing is saved until they tap a Bucket. One saved from a snapped Receipt is dated as the Receipt is, with it attached.
Quick Add offers the **five likely Buckets** (the note's merchant by Rule or past filing first, then recent use near this time of day, then the Plan's order) and **More Buckets**, a searchable list of the rest, so nothing scrolls on a phone; on a computer it's a **Find a Bucket** list (letters filter, ↑/↓ move, Enter adds). Never the other Parent's Personal Allowance (ADR-0031).
_Avoid_: Manual entry, pending

**Import**:
A batch of Transactions brought in from an Account, whether from a statement file or a Bank Connection.
It leaves out lines already in the Account and lines a Parent deleted from it (ADR-0045).
_Avoid_: Sync, upload, feed

**Bank Connection**:
An ongoing authorized link to a financial institution that produces Imports automatically: when the institution says there's news, and at least daily. When its login lapses it waits for a Parent to reconnect (log in again) and brings in nothing meanwhile.
Each is one login at one institution and covers every account under that login. Reconnecting keeps the same Bank Connection.
A Parent chooses **how far back** it goes when they connect it: this month only (a fresh start, recommended) or the last 30, 60, 90, 120 or 365 days. No Import from it keeps a Transaction dated before that start, and the start can't be changed afterwards (ADR-0017). One connected before this was asked keeps everything. It goes through Plaid (ADR-0017), which counts each one against a small allowance.
Connecting asks, for each account there, which Account the Household already has it as (Noodle suggests one by name, kind and last digits), or adds it as a new Account, or leaves it out (ADR-0020). An Account paired this way keeps everything on it; its bank's lines that a statement already brought in aren't added again. Stopping keeps the Account, kept by hand or by statements again.
A Parent can **stop syncing** one Account (unlink it; ADR-0046): that Account is kept by hand or by statements from then on, with all its Transactions, and the Bank Connection's other Accounts go on syncing. Stopping the last one disconnects the Bank Connection. To sync it again the Parent chooses it for the Bank Connection again, or connects the bank again; nothing already there is added twice.
_Avoid_: Integration, link, Plaid (as a domain term)

**Pending**:
An imported Transaction the bank has reported but not yet posted. It counts like any other, but may still change or disappear; when it posts, the posted Transaction takes its place (keeping its assignment, For, Splits and note), so it never counts twice.
_Avoid_: Authorization, hold, uncleared

**Match**:
The pairing of a Quick Add with the imported Transaction that represents the same real-world spend, so it counts once. A bank's line for a line a statement already brought in isn't Matched but left out: the statement's stays (ADR-0020).
_Avoid_: Dedupe, merge, reconcile

### Assistance

**Setup**:
The step-by-step start a new Household is walked through after it's created: how spending comes in (a bank, a statement, or by hand), Take-home pay, bills, Buckets, one Goal, inviting the other Parent, and a summary ending in Free to Spend.
Each step lands on the Plan as it's finished, and leaving and coming back resumes. With a bank or a statement, Noodle reads the spending in the background and fills in amounts marked "Suggested from your spending", never replacing what a Parent typed. A Parent can run it again from Household settings, which changes what's there. The other Parent, on joining, gets "Here's your Household" instead.
_Avoid_: Onboarding, tour, wizard (in the app's own words)

**Check-in**:
The weekly, few-minute ritual where the Parents clear Review, act on Insights, and decide Sweeps and Extra income. The only time the app asks for attention.
It falls on the Household's chosen Check-in day; its week runs from that day. At 9 AM that day (or when their quiet hours end) each Parent who hasn't done it gets one Nudge and an email summary, both read for them alone. It opens as a short card stack (Review, Insights, Sweeps, Extra income, skipping any with nothing in it) that ends on a done state, even when nothing needed them. Each Parent does their own; each sees whether the other has done this week's.
_Avoid_: Review session, weekly budget, reconciliation

**Pace**:
Where a Bucket's spending should be by today if spent evenly across the month; a Bucket is ahead of or behind Pace.
_Avoid_: Burn rate, target, on track

**Receipt**:
An itemized record of a purchase (photo or forwarded email) attached to a Transaction, used to fill in its Splits.
A Parent forwards one to the Receipt address, or snaps one in Quick Add; it's attached to the Transaction with its total to the cent (for a forwarded one, a Quick Add is made when there's none yet; a snapped one fills in Quick Add for the Parent to save). Its lines must add up to its total, each discount staying with its item and tax shared out; when the model was sure of every item and nobody has decided the Transaction's assignment, its Splits are applied on their own, otherwise a Parent applies them from the Transaction's detail.
_Avoid_: Proof, attachment, invoice

**Receipt address**:
The Household's one email address for forwarding Receipts (`receipts+<key>@…`). Only mail from a Parent's verified address is accepted; making a new one stops the old one working.
_Avoid_: Inbox, drop box

**Nudge**:
A notification the app sends on its own because something changed that a Parent would want to know now (a Bucket passing Pace, Extra income arriving, the other Parent's Quick Add).
_Avoid_: Alert, push, reminder

**Review**:
The set of Transactions whose assignment is uncertain and awaits a Parent's confirmation.
A Parent can always decide one: confirm or pick within its own month's Plan, or **file it without a Bucket** (it leaves Review unassigned and changes no month's figures), which is how Transactions from months before the Plan, or from a month that's over, are cleared.
One a Parent **put back** with Undo waits for a Parent: background AI doesn't file it again by itself (#105).
_Avoid_: Inbox, queue, uncategorized

**Rule**:
A learned or stated mapping from a merchant pattern to an assignment and For, created when a Parent corrects or confirms a Transaction.
_Avoid_: Filter, auto-categorization

**Insight**:
A suggested change to the Plan or to spending, backed by the specific Transactions that justify it and its estimated yearly impact. Never applied without a Parent's action.
_Avoid_: Tip, recommendation, alert

**Suggestion**:
Something background AI spotted in spending that a Parent can add with one tap: a new Bucket, a new Commitment, or a Commitment's new amount, shown with its evidence ("about $120 a month across 9 charges"). "Not now" puts it away until the evidence changes a lot. One resting on a Parent's Personal Allowance is shown only to them. Not an **Insight**, which points out a saving.
_Avoid_: recommendation, tip

**Report**:
A view of where the Household's money went over a period (by Bucket, merchant, Member, Goal or income), compared with an earlier period, from the whole Household down to the Transactions behind any number. Counts spending as the Viewer may see it: the other Parent's Personal Allowance only as totals.
_Avoid_: Analytics, dashboard, stats

**Ask**:
A plain-language question from a Parent about the Household's money, answered from its real figures (as that Parent may see them) with links to the screens that show more. Nothing asked is kept.
_Avoid_: Chat, assistant, bot

**Overlap**:
Paying twice for the same benefit: two services that serve the same need, a service already included by a Perk, or the same charge appearing twice.
_Avoid_: Double spending, duplicate

**Perk Source**:
A confirmed product the Household holds that bundles benefits: a phone plan, credit card, membership, or insurance policy. A credit card a Bank Connection brings in is one by itself, without a Parent adding it; when the bank doesn't say which card it is, a Parent is asked once ("Which Chase card is this?") (ADR-0044).
_Avoid_: Provider, card, subscription

**Perk**:
A specific benefit included with a Perk Source: a service it includes, a cost it pays back, or a kind of purchase it earns more on. Each has the link it came from, the page's own words, and the date it was last checked. A card's Perks are listed most valuable first, and "Worth using" sets them against the Household's own spending: credits that went unused, charges on other Accounts the card would pay back, and the kinds of purchases it earns more on. Only ever about a card the Household already has. The page that lists them is named "Perks & Benefits" (it was "Credit card perks"; Perk Sources are not only cards); that is the page's name only, and the term stays Perk.
_Avoid_: Benefit, reward, feature

### Exploring

**Scenario**:
A hypothetical copy of the Plan with Changes made to it, projected forward in time to compare against the real Plan. Can be applied to become the real Plan: applying shows exactly what will change in the Plan first, then records on the Scenario who applied it and when, and each Plan change it makes names it ("from Scenario X"). Muted Changes and assumptions aren't applied; a one-off expense can be made a Goal instead. A Household's saved Scenarios are listed in the Scenarios overview (each with its headline outcome, who made it, when it last changed, and whether it was applied), where up to three can be compared side by side, as charts and key numbers.
_Avoid_: Simulation, what-if, forecast

**Change** (in a Scenario):
A single adjustable quantity in a Scenario: the Take-home pay, a Bucket allowance, a Commitment's terms, a Commitment ended or added, a one-off expense or income, a Bucket added or archived, a Goal changed or added, or yearly growth in income and costs (an Insight accepted becomes one). Each holds for a range of months, from its first month up to, but not including, the month it ends, or for good. Only what the Plan stores can be applied: a one-off or growth is an assumption. A Change can be muted: it stays in the Scenario, but is left out of the projection and isn't applied, to see the outcome without it. A Change whose Bucket, Commitment or Goal is no longer in the Plan does nothing and is flagged "No longer in the Plan" until removed. It is a different thing from a Plan change, which is real; in the UI a Scenario's are "Your changes".
_Avoid_: Lever, slider, knob, variable

**Change preset**:
A Change written into a link, so Explore opens with the change already made: its kind, then its fields, colon-separated, with amounts in cents and an optional range last (`end-commitment:<id>:2027-03`). A Commitment's "Try ending this", an Affordability Check, Insights and Ask open Explore this way. A preset only says what to change; one whose Bucket, Commitment or Goal isn't in the Plan, or that touches the other Parent's Personal Allowance, is dropped.
_Avoid_: Lever preset, deep link

**Projected balance**:
The money a Scenario projects the Household to have month by month: a starting balance (from Accounts, later) plus each month's Free to Spend and one-offs, carried forward. Its lowest point, and the first month it goes below zero, show whether a Scenario holds up.
_Avoid_: Cushion, running balance, runway

**Affordability Check**:
An evaluation of whether the Household can take on a specific purchase (a home, a car, anything) given the Plan, Goals, and what's Set aside, answered as Comfortable, Stretch, or Not yet. Can be turned into a Scenario.
_Avoid_: Calculator, affordability calculator

### People

**Household**:
The family unit that shares one Plan and one pool of money.
Its name, time zone, Members, Check-in day, Nudges and ways of bringing in spending are set on **Household settings**, a page of settings only; reports about the Household live in Reports.
_Avoid_: Account, family, workspace

**Member**:
A person in the Household, either a Parent or a Child.
_Avoid_: User, person, profile

**Parent**:
A Member who can sign in and manage the Plan.
_Avoid_: Admin, owner, partner

**Child**:
A Member whose spending is tracked but who does not sign in.
_Avoid_: Kid, dependent

**For** (attribution):
The Member(s) a Transaction or Split was spent on — one Member, several, or the whole Household. Independent of its assignment.
_Avoid_: Tag, assignee, owner

## Relationships

- A **Household** has one **Plan** per month, two **Parents**, and any number of **Children**.
- A **Plan** contains **Commitments**, **Buckets**, and **Goals**; whatever remains is **Free to Spend**, which starts fresh each month unless the Household has it **Build up**.
- An **Account** is paired with at most one account at one **Bank Connection**.
- A **Transaction** belongs to one **Account** and is assigned whole or via **Splits**; each carries a **For**.
- A **Goal**'s money is **Set aside** on exactly one **Account**.
- A **Payoff Goal** belongs to exactly one credit card or loan **Account**, which has at most one active one.
- An **Insight** may become a **Change** in a **Scenario**; an **Affordability Check** may become a **Scenario**.
- A **Perk** belongs to a **Perk Source**; an **Overlap** is detected between a Perk or Commitment and other spending.

## Flagged ambiguities

- "Budget" was used for both the whole Plan and a single Bucket's allowance — resolved: the whole is the **Plan**; a Bucket has an **allowance**.
- "Transfer" was used for both real money moving between Accounts and planned money moving within the Plan — resolved: real = **Transfer**, planned = **Move**.
- "Double spending" covered duplicate charges, redundant services, and perk-covered services — resolved: all are **Overlaps**.
