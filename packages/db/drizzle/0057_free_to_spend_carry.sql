CREATE TABLE `free_to_spend_carry` (
	`household_id` text NOT NULL,
	`month` text NOT NULL,
	`carries` integer NOT NULL,
	PRIMARY KEY(`household_id`, `month`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `households` ADD `free_to_spend_keep_cents` integer DEFAULT 0 NOT NULL;