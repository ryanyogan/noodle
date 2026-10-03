# A Rule targets a Bucket or a Commitment

A Rule files matching Transactions into exactly one target: a Bucket (`rules.bucket_id`) or a Commitment (`rules.commitment_id`), enforced by a CHECK constraint (#49). A Rule into a Commitment is always the Household's (Commitments have no owner), so only a Rule into a Personal Allowance stays private (ADR-0003). Filing into a Commitment is guarded in SQL like a Bucket: one of the Household's, in the Plan for the Transaction's month.

SQLite can't drop `NOT NULL` in place, so migration 0039 rebuilds `rules`, copying every row unchanged. D1 keeps foreign keys on and dropping `rules` cascades to `rule_for`, so its rows are copied aside first and put back (`INSERT OR IGNORE`) after. `categorizations.commitment_id` records which Commitment a Rule filed to.
