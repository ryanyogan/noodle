ALTER TABLE `fresh_starts` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `fresh_starts` ADD `progress_at` integer;--> statement-breakpoint
ALTER TABLE `fresh_starts` ADD `failed_step` text;--> statement-breakpoint
ALTER TABLE `fresh_starts` ADD `failed_at` integer;--> statement-breakpoint
ALTER TABLE `fresh_starts` ADD `agreed_by` text;--> statement-breakpoint
ALTER TABLE `fresh_starts` ADD `delete_backups` integer;