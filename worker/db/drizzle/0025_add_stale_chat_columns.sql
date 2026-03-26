ALTER TABLE `project_settings` ADD `auto_close_minutes` integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE `conversations` ADD `last_activity_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `conversations` ADD `visitor_last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `visitor_presence` text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `conversations` ADD `visitor_last_online_at` integer;
