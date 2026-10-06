CREATE TABLE `household_passes` (
	`household_id` text NOT NULL,
	`pass` text NOT NULL,
	`run_id` text NOT NULL,
	`snapshot_id` text,
	`changed` integer DEFAULT 0 NOT NULL,
	`ran_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`household_id`, `pass`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
