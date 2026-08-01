ALTER TABLE `conversations` ADD `external_action_started_at` integer;--> statement-breakpoint
CREATE INDEX `idx_conversations_archived` ON `conversations` (`archived_at`);