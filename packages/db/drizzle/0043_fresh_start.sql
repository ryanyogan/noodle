CREATE TABLE `fresh_starts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`level` text NOT NULL,
	`requested_by` text NOT NULL,
	`run_at` integer NOT NULL,
	`status` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`label` text,
	`cancelled_by` text,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `fresh_starts_household_idx` ON `fresh_starts` (`household_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `merchant_vectors` (
	`household_id` text NOT NULL,
	`merchant` text NOT NULL,
	PRIMARY KEY(`household_id`, `merchant`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
