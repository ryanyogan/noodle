CREATE TABLE `moves` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`month` text NOT NULL,
	`from_bucket_id` text,
	`to_bucket_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moves_household_month_idx` ON `moves` (`household_id`,`month`);