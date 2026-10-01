CREATE TABLE `bank_line_pairs` (
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`bank_key` text NOT NULL,
	`row_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`account_id`, `bank_key`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_line_pairs_row_idx` ON `bank_line_pairs` (`row_id`);