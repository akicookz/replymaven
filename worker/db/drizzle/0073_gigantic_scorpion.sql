CREATE TABLE `help_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_help_tabs_project_sort` ON `help_tabs` (`project_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `help_categories` ADD `tab_id` text REFERENCES help_tabs(id);