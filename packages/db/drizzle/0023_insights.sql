CREATE TABLE `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`owner_member_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`yearly_impact_cents` integer NOT NULL,
	`transaction_ids` text NOT NULL,
	`commitment_ids` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`fingerprint` text NOT NULL,
	`decided_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insights_household_fingerprint_idx` ON `insights` (`household_id`,`fingerprint`);