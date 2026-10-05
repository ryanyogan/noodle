CREATE TABLE `deleted_bank_lines` (
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`deleted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`account_id`, `external_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
