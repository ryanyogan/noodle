ALTER TABLE `bank_connections` ADD `last_webhook_at` integer;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `webhook_url` text;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `new_accounts` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `sync_started_at` integer;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `sync_pending` integer DEFAULT false NOT NULL;