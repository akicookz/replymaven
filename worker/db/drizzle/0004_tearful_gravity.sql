CREATE TABLE `crawled_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crawled_pages_resource_url` ON `crawled_pages` (`resource_id`,`url`);--> statement-breakpoint
CREATE INDEX `idx_crawled_pages_resource` ON `crawled_pages` (`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_crawled_pages_project` ON `crawled_pages` (`project_id`);