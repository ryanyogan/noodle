CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`member_id` text,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`payload` text NOT NULL,
	`evidence` text NOT NULL,
	`fingerprint` text NOT NULL,
	`decided_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_household_key_idx` ON `suggestions` (`household_id`,`key`);