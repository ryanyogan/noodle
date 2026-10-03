# Review keeps sub-threshold guesses, records why, and can look again

Status: accepted (2026-10-02, #50)

## Context

In production every Review card had no guess. Categorization ran, but it threw away everything short of filing: a similar merchant below `SIMILAR_MERCHANT_SCORE` (0.9), and an unsure guess of the importing Parent's own Personal Allowance. A Review row didn't record where its guess came from, so "the model said none" looked the same as "the model's answer couldn't be read". And a row was categorized once, against the Buckets that existed at import time, so adding Buckets later changed nothing.

## Decision

- **What files is unchanged.** A Rule, a similar merchant at 0.9 or more, or the model at `AUTO_FILE_CONFIDENCE` (0.8) or more files a Transaction. Everything below is a suggestion only.
- **Keep more guesses.** In Review the guess is the model's Bucket if it named one (any confidence), else the nearest merchant filed before if it's at least `SIMILAR_GUESS_SCORE` (0.75) alike. Different merchants of the same kind score up to 0.83 on our embedding model ("hulu" to "netflix"), and so do some unrelated ones ("walmart supercenter" to "the home depot"). That's good enough to suggest when the card names the merchant it's like, and not good enough to file.
- **Personal Allowance guesses.** An unsure guess of the importing Parent's own Personal Allowance is kept, never filed. `loadReview` shows it only to that Parent. To the other Parent the card has no guess (ADR-0003).
- **Record why.** `categorizations.method` is now set on Review rows too (`rule`, `similar`, `model`, or `none`), and a new `reason` column holds the similar merchant's name or the model's few words ("looks like dining out"). Rows from before this change have `method` null, which means not known.
- **Log, don't fail silently.** An unreadable model answer is logged with the Import ID and the reason ("not JSON", "unanswered", "unknown Bucket code"), never the merchants. Every run logs counts per method, including none.
- **Look again.** `lookAgainAtReview` runs the same pipeline on the Review rows the viewer imported (at most 200), with the viewer's Rules and Buckets. What's now sure is filed and the rest get a new guess. It's idempotent. It runs from Review's "Look again" button and in the background after a Bucket is added. The other Parent's rows are theirs to look at again, because their private Rules and Personal Allowance apply.

## Consequences

- The model is asked for a short `why`, which adds roughly 15 tokens per merchant. A prompt of ten still finishes well inside waitUntil's 30 seconds.
- Adding a Bucket can cost one model run over the viewer's Review rows.
- An undo (returnToReview) keeps the guess's method and reason, but still drops a Personal Allowance guess.

## Addendum: the Review page (phase 2)

- **A list, grouped by month, newest first**, rather than one card on a stack. The keys still act on one card (outlined): right or Enter confirms, left opens its picker, down skips to the next. Swiping is gone, since every card has its buttons in reach. Alternative: list-detail on desktop and the swipe stack on phones; rejected as two layouts to keep in step.
- **Picking files at once.** The card's picker (the Combobox) lists its own month's Buckets this Parent can assign and its Commitments; choosing one files the card, with the usual Undo. Splits, notes and For are still changed in the editor (the pencil).
- **A month with nothing to file in** says so ("September has no Plan yet") with a link to that month's Buckets. A Transaction is only assigned within its own month's Plan, so the card never offers another month's Buckets.
- **Batch confirm** ("Confirm all N with a suggestion", "Confirm all N from <merchant>") has one Undo. It isn't sticky: filing a Transaction doesn't move money between Buckets, the same as a single card's Undo.
- **The Rule offer is a toast** with an "Always file" action, so a decision never pushes the next card down.

## Addendum: the stack comes back as a view (#68)

The Parents missed the cards, so Review opens on **Sort** (one card at a time, swipeable) when there are cards, with the list one tap away (`?view=list`). This revisits "two layouts to keep in step" above: Sort is not a second layout but a second **view** over the same cards, the same `ReviewCard`, and the same decisions (`useReviewDecision`, `useConfirmAll`, `useReturnToReview`). The stack's own state (skipped, put back on top, what Undo returns) is one pure reducer (`review-stack.ts`) with unit tests, and a toast's Undo goes through it too, so there is one Undo history.

- Every swipe has a button and a key: → or Enter confirms, ← picks another, ↓ skips, Z undoes, S splits, P files in the Parent's own Personal Allowance, R makes a Rule. Under reduced motion there is no drag and no motion at all.
- In Sort, what was just done is said beside the card (a polite status: "Filed Coffee in Eating out. 4 left.") and the "Always file …" offer sits there too, rather than toasts over the card's controls. Failures still toast. The list keeps its toasts.
- After each decision focus moves to the next card (its name reads the merchant, amount and suggestion), or to the finish.
- A card from a month with no Plan says so when → or ← is pressed, and can only be skipped.
- Desktop master-detail for the list (#67) is still to come.
