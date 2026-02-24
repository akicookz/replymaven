CREATE TABLE `availability_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_availability_rules_project` ON `availability_rules` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_availability_rules_day` ON `availability_rules` (`project_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `booking_config` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`slot_duration` integer DEFAULT 30 NOT NULL,
	`buffer_time` integer DEFAULT 0 NOT NULL,
	`booking_window_days` integer DEFAULT 14 NOT NULL,
	`min_advance_hours` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_booking_config_project` ON `booking_config` (`project_id`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text,
	`visitor_name` text NOT NULL,
	`visitor_email` text NOT NULL,
	`visitor_phone` text,
	`notes` text,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_bookings_project` ON `bookings` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_bookings_project_start` ON `bookings` (`project_id`,`start_time`);--> statement-breakpoint
CREATE INDEX `idx_bookings_status` ON `bookings` (`status`);