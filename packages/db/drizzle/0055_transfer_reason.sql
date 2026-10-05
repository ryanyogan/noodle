ALTER TABLE `transfers` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `other_account_id` text REFERENCES accounts(id);