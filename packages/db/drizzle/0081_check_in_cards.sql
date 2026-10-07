CREATE TABLE `check_in_cards` (
	`household_id` text NOT NULL,
	`member_id` text NOT NULL,
	`week` text NOT NULL,
	`kind` text NOT NULL,
	`started` text NOT NULL,
	`started_at` integer NOT NULL,
	PRIMARY KEY(`member_id`, `week`, `kind`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `check_in_cards_household_week_idx` ON `check_in_cards` (`household_id`,`week`);
