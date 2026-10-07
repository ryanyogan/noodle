ALTER TABLE `transactions` ADD `bank_took_back_on` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `bank_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `income` ADD `bank_took_back_on` text;--> statement-breakpoint
ALTER TABLE `income` ADD `bank_amount_cents` integer;
