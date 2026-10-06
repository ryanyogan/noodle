ALTER TABLE `income` ADD `pay_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `money_in_rules` ADD `pay_member_id` text REFERENCES members(id);
