# Download your data: a ZIP per Parent, built in a Workflow, kept 24 hours

A Parent can take the Household's data out from Household → Your data. "Prepare download" starts an Export Workflow (`EXPORT`, `noodle-export`) that builds a ZIP for that Parent and stores it in the statements R2 bucket at `exports/<household>/<id>.zip`. When it's ready the Household Agent tells open screens, and the button becomes "Download (ready until 3:40 PM tomorrow)".

## What's in it

- `transactions.csv` (date, Account, merchant, note, amount, Bucket, Commitment, Goal, Splits, For, and the day the bank took a kept line back or what it lowered it to), `accounts.csv` with each Account's latest balance, `plan.csv` (each month's take-home pay, Commitments, Buckets with allowances, then Goals), `plan-changes.csv`, `log-removed.csv` (the Log's own record of Rules removed, Bank Connections disconnected and Accounts archived), `rules.csv`, `money-in.csv` (every money-in line with its kind, the Account it came from when it says one, and whose pay it is), `money-in-rules.csv` (what each Rule for money in remembers: the wording, what it always is, the two Accounts of a remembered pair, whose pay, who set it and when), `card-payment-rules.csv` (each wording remembered as a card payment and its card), `owed-back.csv` (what someone said they'd pay back and how much of it is Paid back), `paid-back.csv` (what each Paid back line settled, and the day it counts on), `refund-links.csv` (each Refund that landed in checking and the purchase it gives money back to), and `household.json` with everything those came from.
- The stored statement files (Imports) and receipt files (the Parent's own, and those on Transactions they see).
- Money is written as numbers in dollars. Text goes through `toCsv`: quoted where needed, and a cell starting `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet never runs it.

## Privacy

The export is read for one Parent, through the same reads the app uses (`loadTransactionsPage`, `privateTotals`, `loadPlanChanges`, `listRules`), so ADR-0003 holds: the other Parent's Personal Allowance Transactions and private Rules are left out, and its spending appears only as one row per month in `transactions.csv`, its total, as the month shows it. So the ZIP belongs to the Parent who asked for it: the download route serves it only to that signed-in Parent, in that Household.

## Workflow and R2

Big Households have years of Transactions and many statement files, so the ZIP is built in a Workflow step, streamed with fflate into an R2 multipart upload (8 MiB parts), holding at most a part and a file chunk in memory. Statement and receipt files are stored without recompressing; the CSVs are deflated. While it builds, an empty `.pending` object marks it "Preparing…"; one older than 30 minutes counts as failed and can be asked for again.

## Expiry

The ZIP's custom metadata holds its Household, its Parent and `expiresAt` (24 hours on). `GET /download-your-data/<id>.zip` checks the Clerk session, the Household, the Parent and the expiry, and answers 404 for anything else; there is no public R2 URL. The nightly cron deletes expired ZIPs and stale `.pending` marks, so a ZIP lives at most about a day past its expiry, but is never served after it. An R2 lifecycle rule would need dashboard or API config, so the sweep was chosen to keep everything in the Worker's code.

Money in and its Rules (`money-in.csv`, `money-in-rules.csv`, `card-payment-rules.csv`, added with issue 141) are the Household's, never private (ADR-0057), so both Parents' downloads hold all of them. A remembered pair of Accounts is listed once, whichever table keeps it.
