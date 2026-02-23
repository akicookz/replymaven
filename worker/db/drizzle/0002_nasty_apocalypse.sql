CREATE TABLE `home_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`icon` text DEFAULT 'link' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_home_links_project` ON `home_links` (`project_id`);--> statement-breakpoint
ALTER TABLE `widget_config` ADD `banner_url` text;--> statement-breakpoint
ALTER TABLE `widget_config` ADD `home_title` text DEFAULT 'How can we help?' NOT NULL;--> statement-breakpoint
ALTER TABLE `widget_config` ADD `home_subtitle` text;