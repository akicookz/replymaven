CREATE TABLE `team_member_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`team_member_id` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`team_member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_member_projects_unique` ON `team_member_projects` (`team_member_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_team_member_projects_member` ON `team_member_projects` (`team_member_id`);--> statement-breakpoint
CREATE INDEX `idx_team_member_projects_project` ON `team_member_projects` (`project_id`);--> statement-breakpoint
ALTER TABLE `team_members` ADD `access_all_projects` integer DEFAULT true NOT NULL;