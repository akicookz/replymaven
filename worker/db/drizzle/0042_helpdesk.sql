CREATE TABLE `help_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_help_categories_project_slug` ON `help_categories` (`project_id`,`slug`);
--> statement-breakpoint
CREATE INDEX `idx_help_categories_project_sort` ON `help_categories` (`project_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `help_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `help_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_help_articles_category_slug` ON `help_articles` (`category_id`,`slug`);
--> statement-breakpoint
CREATE INDEX `idx_help_articles_project` ON `help_articles` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_help_articles_project_status` ON `help_articles` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_help_articles_category_sort` ON `help_articles` (`category_id`,`sort_order`);
--> statement-breakpoint
ALTER TABLE `resources` ADD `source_article_id` text REFERENCES help_articles(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `project_settings` ADD `help_custom_url` text;
