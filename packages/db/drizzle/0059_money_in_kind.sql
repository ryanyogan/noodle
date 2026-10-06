ALTER TABLE `income` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `income` ADD `needs_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `income` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `money_in_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`pattern` text NOT NULL,
	`kind` text NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `money_in_rules_household_pattern_idx` ON `money_in_rules` (`household_id`,`pattern`);
