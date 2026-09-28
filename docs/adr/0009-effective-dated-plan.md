# The Plan is stored effective-dated, not copied each month

Each month's Plan starts as a copy of the previous one. Instead of copying rows when a month is first opened, the Plan is stored as effective-dated records: a Baseline (`baselines`) or a Bucket's allowance (`bucket_allowances`) set for a month holds for every later month until it is set again, and a Bucket is part of the Plan from its `from_month` until its `archived_from_month`. `planForMonth` in `packages/domain` resolves the Plan for any month from these records. We chose this because there is no "first access" write to race between the two Parents, no month to backfill when nobody opened the app for a while, and a change made this month carries forward without touching later months that were never changed on their own.

## Consequences

- Changing an allowance or the Baseline for a month is an idempotent upsert keyed by (Bucket or Household, month); a retry lands once.
- Changing the current month also changes every later month that hasn't been set separately, so the client refetches all cached months after a Plan change.
- Past months' Plans are closed: the server refuses changes to months before the Household's current month.
- Rolling Buckets' rollover (#12) is derived from spending across months, not stored in the Plan.
