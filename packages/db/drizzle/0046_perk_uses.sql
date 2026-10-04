CREATE TABLE `perk_uses` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`perk_id` text NOT NULL,
	`member_id` text NOT NULL,
	`used_on` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `perk_sources` ADD `annual_fee_cents` integer;--> statement-breakpoint
ALTER TABLE `perks` ADD `value_cents` integer;--> statement-breakpoint
ALTER TABLE `perks` ADD `renews` text;