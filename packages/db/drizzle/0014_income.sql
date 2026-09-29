CREATE TABLE `income` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `income_household_date_idx` ON `income` (`household_id`,`date`);--> statement-breakpoint
ALTER TABLE `households` ADD `emergency_goal_id` text REFERENCES goals(id);