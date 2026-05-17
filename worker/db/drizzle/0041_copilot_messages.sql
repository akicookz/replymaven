CREATE TABLE `copilot_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sources` text,
	`agent_user_id` text,
	`auto_suggest` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_messages_conversation` ON `copilot_messages` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_messages_conversation_created` ON `copilot_messages` (`conversation_id`,`created_at`);
