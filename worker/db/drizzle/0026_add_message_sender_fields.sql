ALTER TABLE `messages` ADD `sender_name` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `sender_avatar` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `user_id` text REFERENCES users(id) ON DELETE SET NULL;
