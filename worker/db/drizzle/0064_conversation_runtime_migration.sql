CREATE TABLE `conversation_runtime_migrations` (
	`project_id` text PRIMARY KEY NOT NULL,
	`directory_cursor` text,
	`directory_complete_at` integer,
	`agent_cutover_at` integer,
	`last_verified_at` integer,
	`mismatch_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
