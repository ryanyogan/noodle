CREATE TABLE `capture_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_tokens_token_hash_unique` ON `capture_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `capture_tokens_live_idx` ON `capture_tokens` (`member_id`) WHERE "capture_tokens"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `captured_via` text;