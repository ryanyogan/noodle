CREATE TABLE `bucket_rolling` (
	`household_id` text NOT NULL,
	`bucket_id` text NOT NULL,
	`month` text NOT NULL,
	`rolling` integer NOT NULL,
	PRIMARY KEY(`bucket_id`, `month`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bucket_rolling_household_idx` ON `bucket_rolling` (`household_id`);