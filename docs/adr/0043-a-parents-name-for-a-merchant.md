# A Parent's name for a merchant: kept apart from the bank's wording, above background AI's

A Parent can rename any Transaction (#95). For one from a bank or a statement that raised three questions a later reader would ask: where the name lives, what "the same merchant" means once its name has changed, and how a Parent's name is told from one background AI gave (ADR-0027) without a migration while two others were queued.

**Two fields, one of them never edited.** `transactions.note` is the bank's wording and the editor no longer changes it for an imported Transaction (before #95 its "Note" field did, which lost the wording and let the next background run name the line again from whatever was typed). `transactions.merchant` is the name. The editor's **Name** field writes it through the versioned Transaction write (ADR-0041: `name` on `updateTransaction` and `splitTransaction`, guarded and bumped with the rest), and only when the Parent changed it. A by-hand Transaction's name is still its note. "Use the bank's name" writes the cleaner's name for the wording rather than clearing the field, so the background run, which only names lines with no name, leaves that Transaction alone.

**The merchant is known by the bank's wording.** `bankMerchantKey(note)` is the `merchantKey` of the cleaned wording, so it is the same for every reference number a merchant's lines carry and does not move when a Parent renames one. Three things use it:

- the offer after a rename ("Call every American Express payment “Amex card”? 12 others") finds the others by it, counting and renaming only Transactions that Parent may change (never one in the other Parent's Personal Allowance, ADR-0003);
- the remembered name is kept by it, and a later Import's line from that merchant takes the name before the cleaner or the model is consulted;
- Rules are also checked against it (`ruleKeys`): a Rule made for "American Express payment" still files the merchant once it is called "Amex card". Review's "Always file …" already used the key stored at categorization, which a rename doesn't touch.

Zelle, Venmo and PayPal lines keep their whole wording as the key: each is a different person or shop, and one rename must not rename them all.

**Precedence: Parent, then AI, then the cleaner, then the raw text** (`merchantNameFor`). Background AI never writes a Transaction that has a name, never writes a Parent's remembered name, and a line whose merchant a Parent named never reaches the model. What the model says is kept only if it reads as that line's merchant (`plausibleMerchantName`: short, words not codes, no reference wording, shares a word with the line or spells out one of its squeezed words); otherwise the cleaner's name stands and nothing is cached.

**Where the Parent's name is kept, for now.** `merchant_names (household_id, raw, name)` has no column for who gave a name. A Parent's is kept in the same table under `raw = "parent<tab>" + bankMerchantKey`; a statement line is never that, and `saveMerchantNames` (AI's writer) refuses such keys. This avoided a third migration in flight. The honest shape is a `given_by` column (`'ai' | 'parent'`) and a `merchant_key` column, with the prefix rows moved over; see the proposal in the #95 handoff.

**The others are renamed without moving their versions.** Calling the merchant's other Transactions by the new name sets `merchant` only and does not bump `version`. A bulk rename that bumped every version would make the same Parent's queued Review decisions on those cards be refused as "changed on another screen" until each list refetched, in the middle of filing a few hundred of them. Because an edit only sends `name` when the Parent changed it, a form left open elsewhere cannot write an old name back.

**The cleaner says what a payment line is.** A line the bank ends "ACH PMT", "E-PAYMENT" or "ONLINE PMT" is named the brand and "payment" ("American Express payment"), with no model. "AUTOPAY" stays "autopay" ("Chase Credit Card autopay"), because `isMoneyMovement` tells a card's own payment from a bill by that word. Only the bank's capitals are rewritten: a name already written for people (Plaid's "Auto Loan Payment") is left as it is.

## Considered

- **A new `display_name` column on Transactions**, leaving `merchant` to AI. Cleaner, but a migration, and every list, Report and export would need to learn a third name.
- **Keying the remembered name by the old display name's `merchantKey`**, as Rules are. It moves with every rename (a second rename would orphan the first), and background AI's name for a line can differ from the cleaner's.
- **Remembering every rename without asking.** A one-off ("Amazon" renamed "Sam's birthday present") would rename every Amazon line. So it is offered, once, with the count.
