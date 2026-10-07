CREATE TABLE `card_payment_waited` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`version` integer NOT NULL,
	`method` text,
	`bucket_id` text,
	`confidence` real,
	`merchant` text NOT NULL,
	`reason` text,
	`kept_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_payment_waited_household_idx` ON `card_payment_waited` (`household_id`);
