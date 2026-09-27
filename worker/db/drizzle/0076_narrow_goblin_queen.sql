CREATE TABLE `message_credit_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pack_id` text NOT NULL,
	`messages` integer NOT NULL,
	`remaining` integer NOT NULL,
	`stripe_payment_intent_id` text NOT NULL,
	`purchased_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_message_credit_grants_payment` ON `message_credit_grants` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_message_credit_grants_user_expiry` ON `message_credit_grants` (`user_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `message_usage_credits` ADD `grant_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `knowledge_pages` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `limit_overrides` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `extra_seats` integer DEFAULT 0 NOT NULL;