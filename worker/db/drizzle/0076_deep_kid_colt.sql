CREATE TABLE `channel_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channel_identities_owner_channel_external` ON `channel_identities` (`owner_id`,`channel`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_identities_user` ON `channel_identities` (`user_id`);