CREATE TABLE `visitor_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`visitor_email` text,
	`reason` text,
	`banned_by` text DEFAULT 'dashboard' NOT NULL,
	`banned_from_conversation_id` text,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`banned_from_conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_visitor_bans_project_visitor` ON `visitor_bans` (`project_id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `idx_visitor_bans_project_email` ON `visitor_bans` (`project_id`,`visitor_email`);