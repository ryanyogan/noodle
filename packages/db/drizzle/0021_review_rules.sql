CREATE TABLE `rule_for` (
	`rule_id` text NOT NULL,
	`member_id` text NOT NULL,
	`household_id` text NOT NULL,
	PRIMARY KEY(`rule_id`, `member_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `rules_household_pattern_idx`;--> statement-breakpoint
ALTER TABLE `rules` ADD `owner_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `rules` ADD `matched_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rules_household_pattern_owner_idx` ON `rules` (`household_id`,`pattern`,coalesce(`owner_member_id`, ''));