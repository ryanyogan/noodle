ALTER TABLE `accounts` ADD `whose_member_id` text REFERENCES members(id);
