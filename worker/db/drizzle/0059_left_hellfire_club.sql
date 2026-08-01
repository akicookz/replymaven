ALTER TABLE `conversations` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `purge_started_at` integer;--> statement-breakpoint
CREATE INDEX `idx_conversations_project_archived` ON `conversations` (`project_id`,`archived_at`);