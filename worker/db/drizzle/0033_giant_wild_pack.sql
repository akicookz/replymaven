CREATE TABLE `knowledge_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`target_resource_id` text,
	`target_guideline_id` text,
	`target_page_id` text,
	`source_conversation_id` text,
	`suggestion` text NOT NULL,
	`reasoning` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_guideline_id`) REFERENCES `guidelines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_page_id`) REFERENCES `crawled_pages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_suggestions_project` ON `knowledge_suggestions` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_suggestions_status` ON `knowledge_suggestions` (`status`);--> statement-breakpoint
DROP TABLE `canned_responses`;--> statement-breakpoint
ALTER TABLE `inquiries` ADD `conversation_id` text REFERENCES conversations(id);--> statement-breakpoint
ALTER TABLE `inquiries` ADD `title` text DEFAULT 'Inquiry' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inquiries_conversation` ON `inquiries` (`conversation_id`);--> statement-breakpoint
ALTER TABLE `project_settings` ADD `intro_message_delay` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `intro_message_duration` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `auto_refinement` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `project_settings` DROP COLUMN `show_intro_bubble`;--> statement-breakpoint
ALTER TABLE `usage` ADD `alerted_80` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `usage` ADD `alerted_100` integer DEFAULT false NOT NULL;