ALTER TABLE `invites` ADD `token_hash` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_idx` ON `invites` (`token_hash`);