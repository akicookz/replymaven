CREATE TABLE `channel_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channel_identities_owner_channel_external` ON `channel_identities` (`owner_id`,`channel`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_identities_user` ON `channel_identities` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_visitor_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`visitor_email` text,
	`reason` text,
	`banned_by` text DEFAULT 'dashboard' NOT NULL,
	`banned_from_conversation_id` text,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_visitor_bans`("id", "project_id", "visitor_id", "visitor_email", "reason", "banned_by", "banned_from_conversation_id", "expires_at", "created_at") SELECT "id", "project_id", "visitor_id", "visitor_email", "reason", "banned_by", "banned_from_conversation_id", "expires_at", "created_at" FROM `visitor_bans`;--> statement-breakpoint
DROP TABLE `visitor_bans`;--> statement-breakpoint
ALTER TABLE `__new_visitor_bans` RENAME TO `visitor_bans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_visitor_bans_project_visitor` ON `visitor_bans` (`project_id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `idx_visitor_bans_project_email` ON `visitor_bans` (`project_id`,`visitor_email`);