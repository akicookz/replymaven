ALTER TABLE `conversations` ADD `sidechat_status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `sidechat_run_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `sidechat_lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `sidechat_updated_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `channel` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `kind` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `message_metadata` text;--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_channel_created` ON `messages` (`conversation_id`,`channel`,`created_at`);