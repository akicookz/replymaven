DROP INDEX `idx_projects_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_slug_global` ON `projects` (`slug`);