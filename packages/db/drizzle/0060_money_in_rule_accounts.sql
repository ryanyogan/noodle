ALTER TABLE `money_in_rules` ADD `into_account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `money_in_rules` ADD `other_account_id` text REFERENCES accounts(id);
