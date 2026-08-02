CREATE TABLE `customer_visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`linked_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customer_visitors_project_visitor` ON `customer_visitors` (`project_id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `idx_customer_visitors_customer` ON `customer_visitors` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`external_id` text,
	`name` text,
	`email` text,
	`phone` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`first_seen_at` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_customers_project` ON `customers` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customers_project_external_id` ON `customers` (`project_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customers_project_email` ON `customers` (`project_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_customers_project_updated` ON `customers` (`project_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `customer_id` text REFERENCES customers(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_conversations_project_customer` ON `conversations` (`project_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_project_customer_activity` ON `conversations` (`project_id`,`customer_id`,`last_activity_at`);--> statement-breakpoint
ALTER TABLE `project_settings` ADD `customer_identity_secret` text;
