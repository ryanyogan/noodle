CREATE TABLE `merchant_names` (
	`household_id` text NOT NULL,
	`raw` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`household_id`, `raw`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant` text;