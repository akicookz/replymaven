CREATE TABLE `greetings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`image_url` text,
	`title` text NOT NULL,
	`description` text,
	`cta_text` text,
	`cta_link` text,
	`author_id` text,
	`allowed_pages` text,
	`delay_seconds` integer DEFAULT 3 NOT NULL,
	`duration_seconds` integer DEFAULT 15 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_greetings_project_sort` ON `greetings` (`project_id`,`sort_order`);
--> statement-breakpoint
INSERT INTO `greetings` (
  `id`, `project_id`, `enabled`, `title`, `author_id`,
  `delay_seconds`, `duration_seconds`, `sort_order`, `created_at`, `updated_at`
)
SELECT
  lower(hex(randomblob(16))),
  `project_id`,
  1,
  `intro_message`,
  `intro_message_author_id`,
  COALESCE(`intro_message_delay`, 3),
  COALESCE(`intro_message_duration`, 15),
  0,
  unixepoch(),
  unixepoch()
FROM `project_settings`
WHERE `intro_message` IS NOT NULL AND length(trim(`intro_message`)) > 0;