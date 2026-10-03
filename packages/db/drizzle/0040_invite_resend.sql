ALTER TABLE `invites` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `sends_that_day` integer DEFAULT 1 NOT NULL;