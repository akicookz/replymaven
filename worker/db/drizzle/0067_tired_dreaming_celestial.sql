ALTER TABLE `project_settings` ADD `help_home_background_url` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `help_home_background_position` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `help_home_background_fit` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `help_theme_default` text DEFAULT 'system' NOT NULL;