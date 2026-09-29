ALTER TABLE `scenarios` ADD `applied_at` integer;--> statement-breakpoint
ALTER TABLE `scenarios` ADD `applied_by_member_id` text REFERENCES members(id);