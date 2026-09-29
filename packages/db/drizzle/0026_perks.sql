CREATE TABLE `perk_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`owner_member_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`catalog_key` text,
	`plan` text,
	`plan_options` text,
	`page_url` text,
	`seen_in` text,
	`status` text NOT NULL,
	`research` text DEFAULT 'idle' NOT NULL,
	`checked_at` integer,
	`fingerprint` text NOT NULL,
	`decided_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `perk_sources_household_fingerprint_idx` ON `perk_sources` (`household_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `perks` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`perk_source_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`matches` text NOT NULL,
	`quote` text NOT NULL,
	`source_url` text NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`perk_source_id`) REFERENCES `perk_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `perks_source_key_idx` ON `perks` (`perk_source_id`,`key`);--> statement-breakpoint
ALTER TABLE `insights` ADD `perk_ids` text DEFAULT '[]' NOT NULL;