CREATE TABLE `message_usage_credits` (
	`message_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_message_usage_credits_user_period` ON `message_usage_credits` (`user_id`,`period_start`);
--> statement-breakpoint
CREATE TRIGGER `message_usage_credits_increment`
AFTER INSERT ON `message_usage_credits`
BEGIN
  INSERT INTO `usage` (
    `id`, `user_id`, `period_start`, `messages_used`,
    `alerted_80`, `alerted_100`, `created_at`
  ) VALUES (
    'usage_' || NEW.`message_id`,
    NEW.`user_id`, NEW.`period_start`, 1, 0, 0, unixepoch()
  )
  ON CONFLICT(`user_id`, `period_start`)
  DO UPDATE SET `messages_used` = `messages_used` + 1;
END;
