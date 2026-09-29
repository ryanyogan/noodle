CREATE TABLE `bank_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`institution` text,
	`credential` text NOT NULL,
	`cursor` text,
	`status` text DEFAULT 'importing' NOT NULL,
	`last_imported_at` integer,
	`created_by_member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_external_idx` ON `bank_connections` (`household_id`,`provider`,`external_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `bank_connection_id` text REFERENCES bank_connections(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_bank_external_idx` ON `accounts` (`bank_connection_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `imports` ADD `bank_connection_id` text REFERENCES bank_connections(id);