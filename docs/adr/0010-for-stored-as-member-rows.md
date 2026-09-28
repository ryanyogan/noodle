# For is stored as one row per Member; no rows means the whole Household

A Transaction's For is kept in a `transaction_for` table, one row per Member it was spent on. A Transaction with no rows is For the whole Household. We rejected a single `for_member_id` column because For can name several Members, and an explicit "whole Household" flag because it adds a second way to say the same thing (a flag plus rows could disagree); an empty set is the one shape that can't. Picking every Member one by one is deliberately *not* the same as Everyone: it says the spending was on each of them.

## Consequences

- Per-Member totals (`forTotals` in `packages/domain`) count whole-Household spending once, as the Household's, never again under each Member. Spending For several Members is shared evenly between them to the cent, so the Members' totals plus the Household's always add up to what was spent.
- For rows are written in the same `db.batch` as the Transaction they describe, guarded to land only if that Transaction is the Household's; an edit replaces them the same way.
- Removing a Child only marks them removed (`members.removed_at`): they leave the pickers, but Transactions already For them keep it, so what they cost stays true.
- A Child's colour uses the same eight identity colours as Buckets (ADR-0008), shown only on the Child's own tile, so Colour still only ever says whose or which something is.
