-- The bell (issue 157, phase 2; ADR-0065). Two new tables and nothing else: no row that is here
-- is read, rewritten or deleted. `sent_nudges` is each Nudge as it was sent to one Parent
-- (`member_id`), recorded then so the bell can list it again; a Nudge about a Personal Allowance
-- is only ever recorded for its owner (ADR-0003). `bell_seen` is how far each Parent has read:
-- Nudges sent up to `nudges_up_to` (epoch ms) and releases up to the day `release`
-- ("YYYY-MM-DD"); no row means a Parent who hasn't opened the bell yet.
CREATE TABLE `sent_nudges` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL REFERENCES households(id),
	`member_id` text NOT NULL REFERENCES members(id),
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`sent_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `sent_nudges_member_idx` ON `sent_nudges` (`member_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `bell_seen` (
	`member_id` text PRIMARY KEY NOT NULL REFERENCES members(id),
	`household_id` text NOT NULL REFERENCES households(id),
	`nudges_up_to` integer NOT NULL,
	`release` text
);
