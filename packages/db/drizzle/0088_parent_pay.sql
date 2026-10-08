-- How a Parent is paid (issue 156, phase 1). Both null, as every Parent is until one says: hourly,
-- or pay that varies, with nothing to set. On a salary: what one paycheck usually is, and when it
-- is due as JSON told apart by "kind" ({"kind":"twice-a-month","days":[1,15]},
-- {"kind":"monthly","day":1}), so every two weeks and weekly can be added without a migration.
ALTER TABLE `members` ADD `paycheck_cents` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `pay_schedule` text;
