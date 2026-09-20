CREATE TABLE `project_inbound_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`address` text NOT NULL,
	`label` text,
	`ignored` integer DEFAULT false NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_inbound_addresses_project_address` ON `project_inbound_addresses` (`project_id`,`address`);--> statement-breakpoint
CREATE INDEX `idx_project_inbound_addresses_project` ON `project_inbound_addresses` (`project_id`);