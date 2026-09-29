CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`refund_transaction_id` text NOT NULL,
	`original_transaction_id` text NOT NULL,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`removed_at` integer,
	`removed_by_member_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refunds_household_idx` ON `refunds` (`household_id`);--> statement-breakpoint
CREATE INDEX `refunds_original_idx` ON `refunds` (`original_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_one_per_refund` ON `refunds` (`refund_transaction_id`) WHERE "refunds"."removed_at" is null;--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`out_transaction_id` text,
	`in_transaction_id` text,
	`in_income_id` text,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`removed_at` integer,
	`removed_by_member_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`out_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_income_id`) REFERENCES `income`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transfers_household_idx` ON `transfers` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_one_per_out` ON `transfers` (`out_transaction_id`) WHERE "transfers"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_one_per_in` ON `transfers` (`in_transaction_id`) WHERE "transfers"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_one_per_income` ON `transfers` (`in_income_id`) WHERE "transfers"."removed_at" is null;