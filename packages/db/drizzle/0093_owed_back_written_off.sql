-- Writing off what is Owed back (issue 158, phase b; ADR-0058, revised 2026-10-08). Two new
-- nullable columns on `owed_back` and nothing else: no row that is here is read, rewritten or
-- deleted, and every item that is here stays as it is, not written off. `written_off_on` is the
-- day a Parent gave up on what was still owed, and `written_off_cents` how much that was. Both
-- are null until then, and null again once it is undone.
ALTER TABLE `owed_back` ADD `written_off_on` text;--> statement-breakpoint
ALTER TABLE `owed_back` ADD `written_off_cents` integer;
