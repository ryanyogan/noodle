# Plan changes are an appended log with JSON before and after

Every Plan write also appends one row to `plan_changes`: who made it, when, what it changed (`kind` and the Bucket, Commitment or Goal), the month it takes effect and its scope ("from-on" or "just", plus `until` for a Scenario's range), and the values it moved from and to. Rows are only ever inserted (ADR-0004). The Plan overview's "What changed", This Month's first-week line and the History in each edit sheet all read from it.

`before` and `after` are JSON text rather than typed columns. The kinds carry different values (an amount, Rolling or Fresh-start, a name, a Commitment's amount, cadence and due date, a Goal's target and date), and a column per value would be mostly empty and grow with every new kind. Nothing sums over them: they are only read back and described, and netting a month's changes per item happens in `@noodle/domain` (`whatChanged`).

The log row is written in the same `db.batch` as the write, before it, as an `insert … select … where` that carries the write's own guard plus "the value really changes". So a refused write logs nothing, `before` reads what was in force just before the write, and a retried write, which changes nothing the second time, logs once. There is no read-modify-write and no trigger.

A Personal Allowance row stores its owner in `owner_member_id`. `loadPlanChanges` redacts in SQL: for the other Parent, such a row comes back as kind "personal-allowance" with no values and no name, so the amounts never leave the database for them (ADR-0003).

Nothing was backfilled: the Plan's earlier writes left no record of who or when. Each Household's history starts with its first logged change, and the UI says so ("History starts Sep 30").

Considered: typed columns per value (queryable, but sparse and a migration per new kind), SQLite triggers (can't know the Author or the Scenario, and hide writes from the code that makes them), and diffing the effective-dated Plan records after the fact (no who, and a change overwritten in the same month is lost).
