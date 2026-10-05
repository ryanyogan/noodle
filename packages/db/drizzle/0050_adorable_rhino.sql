CREATE TABLE `perk_pages` (
	`url` text PRIMARY KEY NOT NULL,
	`final_url` text NOT NULL,
	`text` text NOT NULL,
	`via` text NOT NULL,
	`fetched_at` integer NOT NULL
);
