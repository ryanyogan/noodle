CREATE TABLE `card_payment_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`pattern` text NOT NULL,
	`account_id` text,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_payment_rules_household_pattern_idx` ON `card_payment_rules` (`household_id`,`pattern`);
