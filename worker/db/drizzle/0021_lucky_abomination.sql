ALTER TABLE `users` ADD `profile_picture` text;--> statement-breakpoint
ALTER TABLE `users` ADD `work_title` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `intro_message_author_id` text REFERENCES users(id);