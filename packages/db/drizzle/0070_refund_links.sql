CREATE TABLE `refund_links` (
	`income_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`counts_on` text NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`income_id`) REFERENCES `income`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_links_household_idx` ON `refund_links` (`household_id`);--> statement-breakpoint
CREATE INDEX `refund_links_transaction_idx` ON `refund_links` (`transaction_id`);
