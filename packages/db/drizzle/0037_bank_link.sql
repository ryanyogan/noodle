CREATE TABLE `bank_link_sessions` (
	`member_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`link_token` text NOT NULL,
	`return_to` text NOT NULL,
	`connection_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `institution_id` text;