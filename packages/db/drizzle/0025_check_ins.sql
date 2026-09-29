CREATE TABLE `check_ins` (
	`household_id` text NOT NULL,
	`member_id` text NOT NULL,
	`week` text NOT NULL,
	`completed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`member_id`, `week`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `check_ins_household_week_idx` ON `check_ins` (`household_id`,`week`);--> statement-breakpoint
ALTER TABLE `households` ADD `check_in_day` integer DEFAULT 0 NOT NULL;