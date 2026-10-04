CREATE TABLE `household_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`taken_by` text,
	`note` text,
	`key` text NOT NULL,
	`bytes` integer NOT NULL,
	`format` integer NOT NULL,
	`migration` text,
	`row_counts` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `household_snapshots_household_idx` ON `household_snapshots` (`household_id`,`created_at`);