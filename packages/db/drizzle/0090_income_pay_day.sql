-- A paycheck counts on its pay day (issue 156, phase 2; ADR-0063). Both null on every row that
-- is here, so nothing counts differently until a pay day is kept on a line: `pay_day` is the pay
-- day (a day key) the Income is the pay for, and the line then counts in that day's month; the
-- bank's `date` and amount are never changed. `pay_day_by_hand` is 1 once a Parent said it by
-- hand, a pay day or (with `pay_day` null) "Not a paycheck for a pay day", which the automatic
-- rule never goes against.
ALTER TABLE `income` ADD `pay_day` text;--> statement-breakpoint
ALTER TABLE `income` ADD `pay_day_by_hand` integer;
