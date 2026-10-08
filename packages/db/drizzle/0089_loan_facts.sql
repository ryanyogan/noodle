-- A loan's facts (issue 153, phase b), on its Account. All null until a Parent says: what was
-- borrowed, what one payment is, the day of the month it is due (1 to 31), and the day of its last
-- payment ("YYYY-MM-DD"). How many payments are left is worked out from these and what's owed.
ALTER TABLE `accounts` ADD `borrowed_cents` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `payment_cents` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `due_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `ends_on` text;
