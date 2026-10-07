-- Who took a Transaction out of Review, and when (issue 142): set from now on when a Parent files
-- one that waits there; null for everything filed before, and for anything nobody filed by hand.
-- Last in the table, as inserts here go by position.
ALTER TABLE `transactions` ADD `review_cleared_by_member_id` text REFERENCES members(id);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `review_cleared_at` integer;
--> statement-breakpoint
-- When a Parent skipped a card of the week's Check-in stack (issue 142): null until they do. The
-- row is already one per Parent, week and card, so a new week starts with nothing skipped.
ALTER TABLE `check_in_cards` ADD `skipped_at` integer;
