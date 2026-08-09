ALTER TABLE `tools` ADD `allowed_channels` text DEFAULT '["public"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `access` text DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE `tools` ADD `schema_fingerprint` text DEFAULT 'legacy-v1' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_tools_project_enabled` ON `tools` (`project_id`,`enabled`);