CREATE TABLE `guidelines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`condition` text NOT NULL,
	`instruction` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_guidelines_project` ON `guidelines` (`project_id`);