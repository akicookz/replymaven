ALTER TABLE `project_settings` ADD `intro_message_delay` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `intro_message_duration` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_settings` DROP COLUMN `show_intro_bubble`;
