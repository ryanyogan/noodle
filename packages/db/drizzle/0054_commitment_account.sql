ALTER TABLE `account_balances` ADD `as_of` text;--> statement-breakpoint
ALTER TABLE `commitments` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `commitments` ADD `carried_balance` integer DEFAULT false NOT NULL;