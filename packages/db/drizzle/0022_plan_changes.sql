CREATE TABLE `plan_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text,
	`month` text NOT NULL,
	`scope` text NOT NULL,
	`before` text,
	`after` text,
	`owner_member_id` text,
	`source` text NOT NULL,
	`scenario_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_changes_household_month_idx` ON `plan_changes` (`household_id`,`month`);--> statement-breakpoint
CREATE INDEX `plan_changes_household_target_idx` ON `plan_changes` (`household_id`,`target_id`);