-- A Rule files into a Bucket or a Commitment (ADR-0030). SQLite can't drop NOT NULL from
-- rules.bucket_id in place, so the table is rebuilt with every row copied as it is. D1 keeps
-- foreign keys on, and dropping `rules` would cascade to `rule_for`: its rows are kept aside
-- first and put back after (OR IGNORE: where the drop didn't cascade, they're still there).
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__rule_for_kept` AS SELECT * FROM `rule_for`;--> statement-breakpoint
CREATE TABLE `__new_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`pattern` text NOT NULL,
	`bucket_id` text,
	`created_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`owner_member_id` text,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`commitment_id` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commitment_id`) REFERENCES `commitments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rules_one_target" CHECK((bucket_id is null) <> (commitment_id is null))
);
--> statement-breakpoint
INSERT INTO `__new_rules`("id", "household_id", "pattern", "bucket_id", "created_by_member_id", "created_at", "owner_member_id", "matched_count", "commitment_id") SELECT "id", "household_id", "pattern", "bucket_id", "created_by_member_id", "created_at", "owner_member_id", "matched_count", NULL FROM `rules`;--> statement-breakpoint
DROP TABLE `rules`;--> statement-breakpoint
ALTER TABLE `__new_rules` RENAME TO `rules`;--> statement-breakpoint
CREATE UNIQUE INDEX `rules_household_pattern_owner_idx` ON `rules` (`household_id`,`pattern`,coalesce(`owner_member_id`, ''));--> statement-breakpoint
INSERT OR IGNORE INTO `rule_for` (`rule_id`, `member_id`, `household_id`) SELECT `rule_id`, `member_id`, `household_id` FROM `__rule_for_kept`;--> statement-breakpoint
DROP TABLE `__rule_for_kept`;--> statement-breakpoint
ALTER TABLE `categorizations` ADD `commitment_id` text REFERENCES commitments(id);
