CREATE TABLE `baselines` (
	`household_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`household_id`, `month`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bucket_allowances` (
	`household_id` text NOT NULL,
	`bucket_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`bucket_id`, `month`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bucket_allowances_household_idx` ON `bucket_allowances` (`household_id`);--> statement-breakpoint
CREATE TABLE `buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`color` integer NOT NULL,
	`position` integer NOT NULL,
	`from_month` text NOT NULL,
	`archived_from_month` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `buckets_household_idx` ON `buckets` (`household_id`);