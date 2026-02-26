CREATE TABLE `tool_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_id` text NOT NULL,
	`conversation_id` text,
	`message_id` text,
	`input` text,
	`output` text,
	`status` text NOT NULL,
	`http_status` integer,
	`duration` integer,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tool_executions_tool` ON `tool_executions` (`tool_id`);--> statement-breakpoint
CREATE INDEX `idx_tool_executions_conversation` ON `tool_executions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_tool_executions_created` ON `tool_executions` (`created_at`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`endpoint` text NOT NULL,
	`method` text DEFAULT 'POST' NOT NULL,
	`headers` text,
	`parameters` text DEFAULT '[]' NOT NULL,
	`response_mapping` text,
	`enabled` integer DEFAULT true NOT NULL,
	`timeout` integer DEFAULT 10000 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tools_project` ON `tools` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tools_project_name` ON `tools` (`project_id`,`name`);