ALTER TABLE `nudge_preferences` ADD `balance_checks` integer;--> statement-breakpoint
CREATE TABLE `balance_check_asks` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL REFERENCES households(id),
	`account_id` text NOT NULL,
	`statement_day` text NOT NULL,
	`nudged_at` integer,
	`put_away_at` integer
);--> statement-breakpoint
CREATE INDEX `balance_check_asks_household_idx` ON `balance_check_asks` (`household_id`);
