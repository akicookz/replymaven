CREATE TABLE `customer_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`type` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_customer_activity_customer_type` ON `customer_activity` (`customer_id`,`type`);