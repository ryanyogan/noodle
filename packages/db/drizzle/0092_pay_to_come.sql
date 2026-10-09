-- Pay to come (issue 159, phase a; ADR-0066). Two new tables and nothing else: no row that is
-- here is read, rewritten or deleted. `pay_to_come` is pay a Parent (`member_id`) has earned that
-- is not in yet: who it is from, how much, and the day it is expected (`expected_on`, optional).
-- It counts nowhere. `pay_to_come_arrivals` is each line of Income one arrived as, with how much
-- of it that line is (`amount_cents`); a row with `not_this` is a Parent saying a line is not that
-- pay, so it is never offered or matched to it again. `income_id` is not a foreign key: a line of
-- Income may be removed (by a Parent, or by the bank taking it back), and what it had covered is
-- then waiting again, because every read joins to the Income that still counts.
CREATE TABLE `pay_to_come` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL REFERENCES households(id),
	`member_id` text NOT NULL REFERENCES members(id),
	`from_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`expected_on` text,
	`recorded_on` text NOT NULL,
	`created_by_member_id` text REFERENCES members(id),
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE INDEX `pay_to_come_household_idx` ON `pay_to_come` (`household_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `pay_to_come_arrivals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL REFERENCES households(id),
	`pay_to_come_id` text NOT NULL REFERENCES pay_to_come(id),
	`income_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`not_this` integer,
	`by_hand` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE INDEX `pay_to_come_arrivals_household_idx` ON `pay_to_come_arrivals` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pay_to_come_arrivals_pair_idx` ON `pay_to_come_arrivals` (`pay_to_come_id`,`income_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pay_to_come_arrivals_income_idx` ON `pay_to_come_arrivals` (`income_id`) WHERE `not_this` IS NULL;
