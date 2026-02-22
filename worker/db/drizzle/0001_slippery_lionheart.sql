ALTER TABLE `project_settings` ADD `company_name` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `company_url` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `industry` text;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `company_context` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `onboarded` integer DEFAULT false NOT NULL;