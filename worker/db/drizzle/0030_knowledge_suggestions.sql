-- Drop canned_responses table
DROP TABLE IF EXISTS `canned_responses`;

-- Create knowledge_suggestions table
CREATE TABLE `knowledge_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`target_resource_id` text,
	`target_guideline_id` text,
	`source_conversation_id` text,
	`suggestion` text NOT NULL,
	`reasoning` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_guideline_id`) REFERENCES `guidelines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_knowledge_suggestions_project` ON `knowledge_suggestions` (`project_id`);
CREATE INDEX `idx_knowledge_suggestions_status` ON `knowledge_suggestions` (`status`);

-- Add auto_refinement column to project_settings
ALTER TABLE `project_settings` ADD `auto_refinement` integer DEFAULT true NOT NULL;
