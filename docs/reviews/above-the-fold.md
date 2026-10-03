# Key information above the fold (#65)

Measured by `apps/web/e2e/above-the-fold.spec.ts` on the busy household: a Plan ($6,200 take-home pay, four Buckets, three of them over), 8 months of history, an Account, a Goal, Close September waiting (the closing week) and Get started 3 of 4 done. The number is the y, in CSS pixels, where the key information starts. The spec fails when any of them starts at or below the fold, so it stays as a regression check. Run with `FOLD_OUT=<dir>` to save a shot of each screen.

Measured 2 October 2026, locally (CI is not running).

| Size | Page | Key information | y | Fold |
|---|---|---|---|---|
| 1440x900 | This Month | Free to Spend (rail top) | 166 | 900 |
| 1440x900 | This Month | first Bucket | 231 | 900 |
| 1440x900 | Plan | Free to Spend (waterfall's last row) | 761 | 900 |
| 1440x900 | Goals | first Goal | 140 | 900 |
| 1440x900 | Accounts | first Account | 140 | 900 |
| 1440x900 | Transactions | month total (rail top) | 140 | 900 |
| 1440x900 | Transactions | first Transaction | 189 | 900 |
| 393x852 | This Month | Free to Spend | 151 | 852 |
| 393x852 | This Month | first Bucket | 719 | 852 |
| 393x852 | Plan | Free to Spend | 249 | 852 |
| 393x852 | Plan | Things to check (folded) | 334 | 852 |
| 393x852 | Goals | first Goal | 242 | 852 |
| 393x852 | Accounts | first Account | 336 | 852 |
| 393x852 | Transactions | month total | 91 | 852 |
| 393x852 | Transactions | first Transaction | 212 | 852 |
| 375x667 | This Month | Free to Spend | 151 | 667 |

Before #65 (393x852): This Month's Free to Spend started at 1052 and the first Bucket at 1935, under Close September, Get started and Extra income; at 1440x900 the first Bucket was at 1277. Plan's Free to Spend was the waterfall's last row, under "Things to check".

What moved it:

- This Month: Free to Spend first on a phone; Close the last month, Get started, Check-in day, Extra income and the chips are one To do strip under it, closed on a phone with a count and their names ("To do 4 Close September · Get started · Extra income · To look at"). From lg the strip sits open in the rail under Free to Spend, so Buckets head the main column; Coming up follows in the rail.
- Plan overview: on a phone, a Free to Spend line first, then Things to check folded to one line naming the most urgent.
- Transactions: from lg, "Spent in {Month}" heads the rail at headline size.

Not measured yet: a Check-in day state, Plan health at 1440 (the probe is optional and found nothing there), the next Commitment due (Bills sit under Buckets on a phone, and Coming up follows the To do strip in the desktop rail).

## Crowding at 320 wide

`apps/web/e2e/phone-crowding.spec.ts` builds the busy household with 12-character Bucket names ("Weekly shops", "Takeout food", "Kids lessons", "Family trips") and $16,200 take-home pay. At 320x640 it fails when This Month, the Plan, a Bucket's page or Transactions cut any text to fewer than about 12 characters, cut an amount at all, split a word over two lines in a heading or row, or scroll sideways. It prints the controls smaller than 44 px to look over (the "?" help buttons, 24 px, and row titles, whose whole row is the tap target).

What it found, and what changed:

- A Bucket's page at 320: "Weekly shops" broke into "Weekl / y / shops" beside Edit and the pager. The title now keeps about 12 characters and the actions drop to their own row.
- This Month's stat row: on a phone, In Buckets and Left in Buckets; Days left is already in the sentence above, and shows again from sm.
- A Bucket row: the name and the figure share the first line; the status is one word ("Over", "Ahead") on the meta line, beside the bar that shows it in colour. "Over by $200" no longer repeats "$200 over".
- Cover's explanation sits behind its "?" on a phone, rather than repeated under each over Bucket.
- The Plan overview on a phone lost the thin empty line under the folded Things to check.
