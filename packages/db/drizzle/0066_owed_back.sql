CREATE TABLE `owed_back` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`split_id` text,
	`who` text NOT NULL,
	`member_id` text,
	`amount_cents` integer NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `owed_back_household_idx` ON `owed_back` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `owed_back_one_per_purchase` ON `owed_back` (`transaction_id`,coalesce(`split_id`, ''));--> statement-breakpoint
CREATE TABLE `paid_back_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`income_id` text NOT NULL,
	`owed_back_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`counts_on` text NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`income_id`) REFERENCES `income`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owed_back_id`) REFERENCES `owed_back`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `paid_back_matches_household_idx` ON `paid_back_matches` (`household_id`);--> statement-breakpoint
CREATE INDEX `paid_back_matches_income_idx` ON `paid_back_matches` (`income_id`);--> statement-breakpoint
CREATE INDEX `paid_back_matches_owed_back_idx` ON `paid_back_matches` (`owed_back_id`);
