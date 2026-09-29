CREATE TABLE `csv_mappings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`mapping` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`file_name` text,
	`file_key` text,
	`status` text NOT NULL,
	`transaction_count` integer DEFAULT 0 NOT NULL,
	`income_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`first_date` text,
	`last_date` text,
	`closing_balance_cents` integer,
	`closing_balance_date` text,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imports_account_idx` ON `imports` (`account_id`);--> statement-breakpoint
ALTER TABLE `income` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `income` ADD `import_id` text REFERENCES imports(id);--> statement-breakpoint
ALTER TABLE `income` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `income_account_external_idx` ON `income` (`account_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `import_id` text REFERENCES imports(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_external_idx` ON `transactions` (`account_id`,`external_id`);