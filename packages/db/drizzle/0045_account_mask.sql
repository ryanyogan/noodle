-- An Account's last four digits (#51), for a short label like "Chase ••1234". Existing rows keep null.
ALTER TABLE `accounts` ADD `mask` text;
