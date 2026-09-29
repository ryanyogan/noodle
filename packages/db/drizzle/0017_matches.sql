CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`quick_add_id` text NOT NULL,
	`imported_id` text NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`removed_at` integer,
	`removed_by_member_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quick_add_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_household_idx` ON `matches` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matches_one_per_quick_add` ON `matches` (`quick_add_id`) WHERE "matches"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `matches_one_per_imported` ON `matches` (`imported_id`) WHERE "matches"."removed_at" is null;