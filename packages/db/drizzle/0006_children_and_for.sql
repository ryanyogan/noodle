CREATE TABLE `transaction_for` (
	`transaction_id` text NOT NULL,
	`member_id` text NOT NULL,
	`household_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `member_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_for_household_member_idx` ON `transaction_for` (`household_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `members` ADD `color` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `removed_at` integer;