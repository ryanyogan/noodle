-- The day the bank (or a statement) gave a Transaction, kept once a Parent has moved it to another
-- day (issue 148, ADR-0060). Null while `date` is still the bank's own, and always for a line typed
-- in. Bank sync, the pending-to-posted takeover, duplicate detection and Matching go by
-- coalesce(bank_date, date); everything a Parent sees and every total goes by `date`.
ALTER TABLE `transactions` ADD `bank_date` text;
