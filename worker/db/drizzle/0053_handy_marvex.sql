ALTER TABLE `conversations` ADD `assignee_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `idx_conversations_assignee` ON `conversations` (`assignee_id`);