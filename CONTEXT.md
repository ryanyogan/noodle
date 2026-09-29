# Noodle

A household budgeting tool for a family (two parents, two kids) that layers a simple monthly plan over real spending, so the day-to-day only asks for attention where it matters.

## Language

### The Plan

**Plan**:
The Household's allocation of one month's Baseline across Commitments, Buckets, and Goals. Each month's Plan starts as a copy of the previous one.
_Avoid_: Budget (as a noun for the whole thing), spending plan

**From <Month> on**:
How far a change to an amount in the Plan (the Baseline, a Bucket's allowance, a Commitment's amount) reaches by default: that month and every later month, unless a later month has its own amount.
_Avoid_: Permanently, going forward, default

**Just <Month>**:
A change to an amount in the Plan for that one month: the month after goes back to the amount before the change, unless it has its own.
_Avoid_: One-off, temporary, override, this month only

**Changed this month**:
An amount in a month's Plan that differs from the month before's, shown with what it was ("Changed this month · was $900").
_Avoid_: Modified, edited, overridden

**Plan change**:
One change a Parent made to the Plan (the Baseline, an allowance, Rolling or Fresh-start, new Commitment terms, a Goal’s target; a Bucket, Commitment or Goal added; a Bucket or Commitment renamed, archived or ended), kept with who made it, when, the month it takes effect and what it was before. "What changed" on the Plan nets a month's Plan changes per item; the other Parent's Personal Allowance only ever reads as "Personal Allowance changed".
_Avoid_: Edit, audit entry, revision

**Commitment**:
A recurring, predictable obligation (mortgage, insurance, daycare, subscriptions) that is expected every period.
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
The warnings on the Plan overview about the Plan as it stands, each linking to its fix: a month ahead whose Free to Spend goes below zero, income running behind the Baseline, a Bucket over its allowance most months (never the other Parent's Personal Allowance), and a Goal that won't reach its target by its date at its current funding.
_Avoid_: Alerts, budget score

**Bucket**:
A monthly allowance for discretionary, variable spending (Hockey, Fun, Life, Groceries), tracked as "amount left." Every Bucket is either Rolling or Fresh-start.
_Avoid_: Envelope, category, budget line

**Rolling Bucket**:
A Bucket whose unspent amount carries into the next month.
_Avoid_: Rollover category, accumulating

**Fresh-start Bucket**:
A Bucket that resets to its allowance each month; any leftover is offered as a Sweep.
_Avoid_: Resetting, use-it-or-lose-it

**Personal Allowance**:
A Bucket belonging to one Parent whose individual Transactions are private to that Parent; the other Parent sees only its totals.
_Avoid_: Fun money, private bucket, hidden spending

**Available**:
What a Bucket has to spend this month: its allowance ("planned"), plus what rolled over from last month (less, if a Rolling Bucket was overspent), plus or minus what was Moved in or out. "Left" is Available less what's been spent; a Rolling Bucket's month-end Left is its balance, carried into the next month.
_Avoid_: Budget, total, remaining

**Goal**:
A target amount (optionally with a target date) the Household funds over time, either to keep (savings) or to spend on a known future big expense. Its money is held as an Earmark.
_Avoid_: Sinking fund, savings bucket, pot

**Earmark**:
The portion of a real Account's balance claimed by a Goal. An Account's balance not claimed by any Goal is Unclaimed.
_Avoid_: Allocation, sub-account, virtual account

**Baseline**:
The Household's normal monthly take-home income that the Plan is built on.
_Avoid_: Expected income, salary, budgeted income

**Windfall**:
Income received beyond the Baseline in a month (an extra paycheck, bonus, refund), awaiting a decision on where it goes.
_Avoid_: Extra income, surplus, bonus

**Free to Spend**:
Money in the current Plan not yet assigned to any Commitment, Bucket, or Goal.
_Avoid_: Unallocated, leftover, safe-to-spend

**Move**:
A reassignment of planned money from one place in the Plan to another, without any real money leaving an Account. Cover, Sweep, and Goal funding are all Moves.
_Avoid_: Transfer, reallocation, adjustment

**Cover**:
A Move that brings an overspent Bucket back to zero from another Bucket or Free to Spend within the same month.
_Avoid_: Rebalance, borrow

**Sweep**:
A Move of a Fresh-start Bucket's month-end leftover into a Goal.
_Avoid_: Rollover, save leftovers

**Month-close**:
Deciding, once a month has ended, where its Fresh-start Buckets' leftovers are Swept and where its pending Windfall goes: by a Parent in the next month's first week, or by the defaults when nobody does. The ended month then shows how it ended: its Sweeps, the Windfall it sent to Goals, what each Rolling Bucket carried into the next month, and who closed it.
_Avoid_: Rollover, reconciliation, closing the books

### Money movement

**Account**:
A real-world place money lives or is owed: a checking/savings account, credit card, line of credit, or loan.
_Avoid_: Bank, card (as a generic term)

**Transaction**:
A single movement of real money in or out of an Account. It is assigned as a whole, or through Splits, to Buckets, Commitments, or Goals.
_Avoid_: Expense, entry, purchase

**Split**:
A portion of one Transaction with its own amount, assignment, and For (e.g. one Costco trip split across Groceries and Hockey).
_Avoid_: Line item, sub-transaction

**Transfer**:
A Transaction pair that moves real money between two of the Household's own Accounts (e.g. paying the credit card). Never counts as spending.
_Avoid_: Payment, Move

**Refund**:
Money returned for a prior purchase; it restores the Bucket the purchase came from.
_Avoid_: Credit, return, income

**Quick Add**:
A Transaction entered by hand at the moment of spending, before any bank data exists for it. One the Parent's iPhone Shortcut captures when they pay with Wallet (tap to capture) is a Quick Add too; it is filed the way imported Transactions are (by Rule, similar merchant, or the model), else goes to Review.
Quick Add can be filled in by snapping a paper Receipt or by saying or typing a phrase ("forty on pizza after hockey"): the amount, a suggested Bucket, For and a note are read for the Parent to check, and nothing is saved until they tap a Bucket. One saved from a snapped Receipt is dated as the Receipt is, with it attached.
_Avoid_: Manual entry, pending

**Import**:
A batch of Transactions brought in from an Account, whether from a statement file or a Bank Connection.
_Avoid_: Sync, upload, feed

**Bank Connection**:
An ongoing authorized link to a financial institution that produces Imports automatically.
_Avoid_: Integration, link, Plaid (as a domain term)

**Match**:
The pairing of a Quick Add with the imported Transaction that represents the same real-world spend, so it counts once.
_Avoid_: Dedupe, merge, reconcile

### Assistance

**Check-in**:
The weekly, few-minute ritual where the Parents clear Review, act on Insights, and decide Sweeps and Windfalls. The only time the app asks for attention.
It falls on the Household's chosen Check-in day; its week runs from that day. At 9 AM that day (or when their quiet hours end) each Parent who hasn't done it gets one Nudge and an email summary, both read for them alone. It opens as a short card stack (Review, Insights, Sweeps, Windfalls, skipping any with nothing in it) that ends on a done state, even when nothing needed them. Each Parent does their own; each sees whether the other has done this week's.
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
A notification the app sends on its own because something changed that a Parent would want to know now (a Bucket passing Pace, a Windfall arriving, the other Parent's Quick Add).
_Avoid_: Alert, push, reminder

**Review**:
The set of Transactions whose assignment is uncertain and awaits a Parent's confirmation.
_Avoid_: Inbox, queue, uncategorized

**Rule**:
A learned or stated mapping from a merchant pattern to an assignment and For, created when a Parent corrects or confirms a Transaction.
_Avoid_: Filter, auto-categorization

**Insight**:
A suggested change to the Plan or to spending, backed by the specific Transactions that justify it and its estimated yearly impact. Never applied without a Parent's action.
_Avoid_: Tip, recommendation, alert

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
A confirmed product the Household holds that bundles benefits: a phone plan, credit card, membership, or insurance policy.
_Avoid_: Provider, card, subscription

**Perk**:
A specific benefit included with a Perk Source, with the link it came from and the date it was last checked.
_Avoid_: Benefit, reward, feature

### Exploring

**Scenario**:
A hypothetical copy of the Plan, changed by Levers, projected forward in time to compare against the real Plan. Can be applied to become the real Plan: applying shows exactly what will change in the Plan first, then records on the Scenario who applied it and when, and each Plan change it makes names it ("from Scenario X"). Muted Levers and assumptions aren't applied; a one-off expense can be made a Goal instead. A Household's saved Scenarios are listed in the Scenarios overview (each with its headline outcome, who made it, when it last changed, and whether it was applied), where up to three can be compared side by side, as charts and key numbers.
_Avoid_: Simulation, what-if, forecast

**Lever**:
A single adjustable quantity in a Scenario: the Baseline, a Bucket allowance, a Commitment's terms, a Commitment ended or added, a one-off expense or income, a Bucket added or archived, a Goal changed or added, or yearly growth in income and costs (an Insight accepted becomes one). Each holds for a range of months, from its first month up to, but not including, the month it ends, or for good. Only what the Plan stores can be applied: a one-off or growth is an assumption. A Lever can be muted: it stays in the Scenario, but is left out of the projection and isn't applied, to see the outcome without it. A Lever whose Bucket, Commitment or Goal is no longer in the Plan changes nothing and is flagged "No longer in the Plan" until removed.
_Avoid_: Slider, knob, variable

**Lever preset**:
A Lever written into a link, so Explore opens with the change already made: its kind, then its fields, colon-separated, with amounts in cents and an optional range last (`end-commitment:<id>:2027-03`). A Commitment's "Try ending this", an Affordability Check, Insights and Ask open Explore this way. A preset only says what to change; one whose Bucket, Commitment or Goal isn't in the Plan, or that touches the other Parent's Personal Allowance, is dropped.
_Avoid_: Deep link, query Lever

**Cushion**:
The money a Scenario projects the Household to have month by month: a starting balance (from Accounts, later) plus each month's Free to Spend and one-offs, carried forward. Its lowest point, and the first month it goes below zero, show whether a Scenario holds up.
_Avoid_: Running balance, runway

**Affordability Check**:
An evaluation of whether the Household can take on a specific purchase (a home, a car, anything) given the Plan, Goals, and Earmarks, answered as Comfortable, Stretch, or Not Yet. Can be turned into a Scenario.
_Avoid_: Calculator, affordability calculator

### People

**Household**:
The family unit that shares one Plan and one pool of money.
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
- A **Plan** contains **Commitments**, **Buckets**, and **Goals**; whatever remains is **Free to Spend**.
- A **Transaction** belongs to one **Account** and is assigned whole or via **Splits**; each carries a **For**.
- A **Goal** is backed by an **Earmark** on exactly one **Account**.
- An **Insight** may become a **Lever** in a **Scenario**; an **Affordability Check** may become a **Scenario**.
- A **Perk** belongs to a **Perk Source**; an **Overlap** is detected between a Perk or Commitment and other spending.

## Flagged ambiguities

- "Budget" was used for both the whole Plan and a single Bucket's allowance — resolved: the whole is the **Plan**; a Bucket has an **allowance**.
- "Transfer" was used for both real money moving between Accounts and planned money moving within the Plan — resolved: real = **Transfer**, planned = **Move**.
- "Double spending" covered duplicate charges, redundant services, and perk-covered services — resolved: all are **Overlaps**.
