ALTER TABLE `inquiry_config` RENAME TO `ticket_config`;--> statement-breakpoint
ALTER TABLE `inquiries` RENAME TO `tickets`;--> statement-breakpoint
ALTER TABLE `tickets` ADD COLUMN `priority` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD COLUMN `assignee_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tickets` ADD COLUMN `due_date` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD COLUMN `updated_at` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
UPDATE `tickets` SET `status` = 'open' WHERE `status` = 'new';--> statement-breakpoint
UPDATE `tickets` SET `status` = 'in_progress' WHERE `status` = 'replied';--> statement-breakpoint
DROP INDEX IF EXISTS `idx_inquiry_config_project`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ticket_config_project` ON `ticket_config` (`project_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_inquiries_project`;--> statement-breakpoint
CREATE INDEX `idx_tickets_project` ON `tickets` (`project_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_inquiries_conversation`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tickets_conversation` ON `tickets` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_status` ON `tickets` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tickets_assignee` ON `tickets` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_priority` ON `tickets` (`priority`);
