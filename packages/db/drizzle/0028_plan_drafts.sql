CREATE TABLE `plan_draft_decisions` (
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`decision` text NOT NULL,
	`member_id` text NOT NULL,
	`decided_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`household_id`, `key`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan_drafts` (
	`household_id` text PRIMARY KEY NOT NULL,
	`labels` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`finished_by_member_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finished_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
