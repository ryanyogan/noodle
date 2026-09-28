CREATE TABLE `commitment_terms` (
	`household_id` text NOT NULL,
	`commitment_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`cadence` text NOT NULL,
	`due_date` text NOT NULL,
	PRIMARY KEY(`commitment_id`, `month`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commitment_id`) REFERENCES `commitments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `commitment_terms_household_idx` ON `commitment_terms` (`household_id`);--> statement-breakpoint
CREATE TABLE `commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`from_month` text NOT NULL,
	`ended_from_month` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `commitments_household_idx` ON `commitments` (`household_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `commitment_id` text REFERENCES commitments(id);