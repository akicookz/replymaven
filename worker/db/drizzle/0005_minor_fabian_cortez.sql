CREATE TABLE `contact_form_config` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`description` text DEFAULT 'We''ll get back to you within 1-2 hours.',
	`fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_form_config_project` ON `contact_form_config` (`project_id`);--> statement-breakpoint
CREATE TABLE `contact_form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`visitor_id` text,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contact_form_submissions_project` ON `contact_form_submissions` (`project_id`);