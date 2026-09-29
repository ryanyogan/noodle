CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text NOT NULL,
	`source` text NOT NULL,
	`transaction_id` text,
	`file_key` text NOT NULL,
	`thumbnail_key` text,
	`merchant` text,
	`date` text,
	`total_cents` integer,
	`lines` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `receipts_household_idx` ON `receipts` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_transaction_idx` ON `receipts` (`transaction_id`);--> statement-breakpoint
ALTER TABLE `households` ADD `receipt_address` text;--> statement-breakpoint
CREATE UNIQUE INDEX `households_receipt_address_unique` ON `households` (`receipt_address`);