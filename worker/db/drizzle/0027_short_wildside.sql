ALTER TABLE `users` ADD `profile_setup_completed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_setup_dismissed_at` integer;--> statement-breakpoint
UPDATE `users`
SET `profile_setup_completed_at` = unixepoch()
WHERE `work_title` IS NOT NULL OR `profile_picture` IS NOT NULL;