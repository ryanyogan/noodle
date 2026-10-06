ALTER TABLE `accounts` ADD `purchases` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `wallet_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `statement_day` integer;--> statement-breakpoint
CREATE TABLE `capture_cards` (
	`transaction_id` text PRIMARY KEY NOT NULL REFERENCES transactions(id),
	`household_id` text NOT NULL REFERENCES households(id),
	`card` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE INDEX `capture_cards_household_idx` ON `capture_cards` (`household_id`);
