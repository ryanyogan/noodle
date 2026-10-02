CREATE TABLE `setup_jobs` (
	`household_id` text NOT NULL,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`household_id`, `job`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `setup_progress` (
	`household_id` text PRIMARY KEY NOT NULL,
	`step` integer DEFAULT 1 NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`skipped` text DEFAULT '[]' NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
